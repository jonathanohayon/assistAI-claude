import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
import { sendWelcomeEmail } from "@/lib/email";
import { addNumberToTrunk } from "@/lib/livekit-sip";
import { logEvent } from "@/lib/logger";
import { featuresForPlan } from "@/lib/plan-features";
import { getPlanFeatureMatrix } from "@/lib/plan-features-storage";
import { computeTrialEndsAt } from "@/lib/trial";
import {
  purchaseNumber,
  releaseNumber,
  searchAvailableNumbers,
} from "@/lib/twilio-numbers";

interface ProvisionBody {
  countryCode?: string;
  areaCode?: string;
  /** If set, skip search and try to purchase this exact number. */
  phoneNumber?: string;
  label?: string;
  /** Default greeting language for this tenant's agent: 'fr' | 'he' | 'en'. */
  primaryLanguage?: string;
}

// POST /api/onboarding/provision
//   1. Find an available Twilio number (or use the explicit one).
//   2. Buy it + attach to the shared SIP trunk.
//   3. Add it to the LiveKit inbound trunk's allowed numbers list.
//   4. Persist phone_numbers row linked to the current user.
//   5. If anything fails after the purchase, release the number to avoid
//      paying for an orphan.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ProvisionBody;
  const countryCode = (body.countryCode ?? "US").toUpperCase();
  const areaCode = body.areaCode?.trim();

  // Refuse to provision a 2nd number for the same tenant — keep onboarding
  // simple. They can add more from /admin later.
  const existing = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, session.user.id))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      {
        error: "Ce compte a déjà un numéro provisionné.",
        phoneNumber: existing[0].phoneNumber,
      },
      { status: 409 },
    );
  }

  // Step 1: pick a number
  let phoneToBuy = body.phoneNumber;
  if (!phoneToBuy) {
    try {
      const available = await searchAvailableNumbers({
        countryCode,
        areaCode,
        limit: 1,
        voiceEnabled: true,
      });
      if (available.length === 0) {
        return NextResponse.json(
          {
            error: `Aucun numéro disponible (${countryCode}${areaCode ? ` / area ${areaCode}` : ""})`,
          },
          { status: 404 },
        );
      }
      phoneToBuy = available[0].phoneNumber;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "search failed";
      await logEvent({
        source: "web",
        event: "provision_search_failed",
        message: `Recherche numéro échouée : ${msg.slice(0, 200)}`,
        level: "error",
        userId: session.user.id,
        metadata: { countryCode, areaCode, error: msg },
      });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Step 2: purchase
  let purchased;
  try {
    purchased = await purchaseNumber({
      phoneNumber: phoneToBuy,
      friendlyName: `${session.user.email} — onboarding`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "purchase failed";
    await logEvent({
      source: "web",
      event: "provision_purchase_failed",
      message: `Achat numéro échoué : ${msg.slice(0, 200)}`,
      level: "error",
      userId: session.user.id,
      metadata: { phoneToBuy, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Step 3 & 4: LiveKit + DB. If either fails, release the Twilio number
  // so we don't pay for an orphan.
  try {
    await addNumberToTrunk(purchased.phoneNumber);

    await db.insert(phoneNumbers).values({
      userId: session.user.id,
      phoneNumber: purchased.phoneNumber,
      label: body.label?.trim() ?? "Numéro principal",
      twilioSid: purchased.sid,
      countryCode,
    });

    // Persist primary language preference on the agent config (if one exists).
    // The migrate script creates the row before onboarding, so this is just
    // an UPDATE — silently skipped if no config row yet.
    if (body.primaryLanguage && ["fr", "he", "en"].includes(body.primaryLanguage)) {
      await db
        .update(agentConfigs)
        .set({ primaryLanguage: body.primaryLanguage, updatedAt: new Date() })
        .where(eq(agentConfigs.userId, session.user.id));
    }

    // Refresh trial start so onboarding ⇒ first day of trial.
    const [me] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (me && !me.trialEndsAt) {
      await db
        .update(users)
        .set({
          trialEndsAt: computeTrialEndsAt(),
          subscriptionStatus: "trialing",
        })
        .where(eq(users.id, session.user.id));
    }

    await logEvent({
      source: "web",
      event: "provision_success",
      message: `Numéro ${purchased.phoneNumber} provisionné pour ${session.user.email}`,
      userId: session.user.id,
      metadata: {
        phoneNumber: purchased.phoneNumber,
        twilioSid: purchased.sid,
        countryCode,
      },
    });

    // Welcome email best-effort : si Resend échoue ou si l'utilisateur n'a
    // plus de row (cas limite : compte supprimé entre la query au-dessus et
    // ici), on log et on continue. Le success de l'onboarding ne dépend
    // PAS de l'email — il a son numéro, c'est l'essentiel.
    if (me?.email) {
      try {
        const planMatrix = await getPlanFeatureMatrix();
        const features = featuresForPlan(planMatrix, me.subscriptionPlan);
        const trialEndsForEmail = me.trialEndsAt ?? computeTrialEndsAt();
        const res = await sendWelcomeEmail(me.email, {
          displayName: me.displayName,
          phoneNumber: purchased.phoneNumber,
          planKey: me.subscriptionPlan,
          features,
          trialEndsAt: trialEndsForEmail,
        });
        if (!res.ok) {
          await logEvent({
            source: "web",
            event: "welcome_email_failed",
            message: `Envoi welcome email à ${me.email} échoué : ${res.error?.slice(0, 200) ?? "?"}`,
            level: "warn",
            userId: session.user.id,
            metadata: { error: res.error },
          });
        } else {
          await logEvent({
            source: "web",
            event: "welcome_email_sent",
            message: `Welcome email envoyé à ${me.email}`,
            userId: session.user.id,
            metadata: { emailId: res.id, fallback: res.fallback },
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        await logEvent({
          source: "web",
          event: "welcome_email_crashed",
          message: `Welcome email crashed : ${msg.slice(0, 200)}`,
          level: "error",
          userId: session.user.id,
          metadata: { error: msg },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      phoneNumber: purchased.phoneNumber,
      twilioSid: purchased.sid,
      countryCode,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "post-purchase failed";
    // Best-effort rollback so we don't leak a billed number.
    await releaseNumber(purchased.sid).catch((err) => {
      console.error("[provision] rollback release failed:", err);
    });
    await logEvent({
      source: "web",
      event: "provision_rollback",
      message: `Provision rollback : ${msg.slice(0, 200)}`,
      level: "error",
      userId: session.user.id,
      metadata: {
        phoneNumber: purchased.phoneNumber,
        twilioSid: purchased.sid,
        error: msg,
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
