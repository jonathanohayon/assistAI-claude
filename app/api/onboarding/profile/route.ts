import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";

interface ProfileBody {
  displayName?: string;
  primaryLanguage?: string;
}

// POST /api/onboarding/profile
//   Persiste deux préférences "douces" choisies à l'étape activité de
//   l'onboarding : le nom affiché de l'entreprise (users.displayName) et la
//   langue principale de l'agent (agentConfigs.primaryLanguage). Best-effort,
//   tout est optionnel — chaque champ est mis à jour seulement s'il est valide.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ProfileBody;

  try {
    const displayName = body.displayName?.trim();
    if (displayName) {
      await db
        .update(users)
        .set({ displayName })
        .where(eq(users.id, session.user.id));
    }

    if (
      body.primaryLanguage &&
      ["fr", "he", "en"].includes(body.primaryLanguage)
    ) {
      await db
        .update(agentConfigs)
        .set({ primaryLanguage: body.primaryLanguage, updatedAt: new Date() })
        .where(eq(agentConfigs.userId, session.user.id));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "profile update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
