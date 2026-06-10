import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

// Internal-only diag : un tour d'horizon de TOUS les tenants pour vérifier
// la santé du routing/whatsapp/google sans avoir à itérer email par email.
// Gated INTERNAL_SECRET. Read-only.
//
// Pour chaque user :
//   - email + role
//   - googleConnected (bool, depuis users.googleRefreshToken)
//   - ownerWhatsapp (texte, depuis agent_configs.owner_whatsapp) + flag bool
//   - phones (liste E.164 mappés à ce user dans phone_numbers)
//   - hasAgentConfig (bool)
export async function GET(req: NextRequest) {
  const auth = requireInternalSecret(req);
  if (!auth.ok) return auth.response;

  const allUsers = await db.select().from(users);
  const allConfigs = await db.select().from(agentConfigs);
  const allPhones = await db.select().from(phoneNumbers);

  const configByUser = new Map<string, (typeof allConfigs)[number]>();
  for (const c of allConfigs) configByUser.set(c.userId, c);

  const phonesByUser = new Map<string, typeof allPhones>();
  for (const p of allPhones) {
    const list = phonesByUser.get(p.userId) ?? [];
    list.push(p);
    phonesByUser.set(p.userId, list);
  }

  const rows = allUsers.map((u) => {
    const cfg = configByUser.get(u.id);
    const phones = phonesByUser.get(u.id) ?? [];
    return {
      userId: u.id,
      email: u.email,
      role: u.role,
      googleConnected: Boolean(u.googleRefreshToken),
      hasAgentConfig: Boolean(cfg),
      ownerWhatsapp: cfg?.ownerWhatsapp ?? "",
      whatsappConfigured: Boolean(cfg?.ownerWhatsapp?.trim()),
      phones: phones.map((p) => ({
        phoneNumber: p.phoneNumber,
        label: p.label,
      })),
      phoneCount: phones.length,
    };
  });

  // Aussi: env sender side (sans leak), pour confirmer qu'on a un canal.
  const senderConfigured = {
    provider: (process.env.WHATSAPP_PROVIDER ?? "meta").toLowerCase(),
    metaPhoneId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    metaAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    twilioSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
    twilioToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    twilioWhatsappFrom: Boolean(process.env.TWILIO_WHATSAPP_FROM),
    metaTemplateName: Boolean(process.env.WHATSAPP_OWNER_TEMPLATE_NAME),
  };
  // Suppress unused — kept available for richer future diag.
  void eq;

  return NextResponse.json({
    sender: senderConfigured,
    tenants: rows,
    totals: {
      users: rows.length,
      withGoogle: rows.filter((r) => r.googleConnected).length,
      withWhatsapp: rows.filter((r) => r.whatsappConfigured).length,
      withPhones: rows.filter((r) => r.phoneCount > 0).length,
      withConfig: rows.filter((r) => r.hasAgentConfig).length,
    },
  });
}
