import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";

// Temp diagnostic: list all tenants, their phone numbers, and a snippet of
// their agent_config instructions. Gated by INTERNAL_SECRET.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const allUsers = await db.select().from(users).orderBy(users.createdAt);
  const result = [];
  for (const u of allUsers) {
    const phones = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, u.id));
    const [cfg] = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, u.id))
      .limit(1);
    result.push({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt,
      phones: phones.map((p) => ({
        phoneNumber: p.phoneNumber,
        label: p.label,
        twilioSid: p.twilioSid,
      })),
      configSnippet: cfg?.instructions?.slice(0, 200) ?? "(no config)",
      configHasJohana:
        cfg?.instructions?.includes("Johana") ||
        cfg?.instructions?.includes("Johanna") ||
        false,
      configHasLea:
        cfg?.instructions?.includes("Lea") ||
        cfg?.instructions?.includes("Léa") ||
        false,
      ownerWhatsapp: cfg?.ownerWhatsapp ?? "",
      configUpdatedAt: cfg?.updatedAt ?? null,
    });
  }
  return NextResponse.json({ tenants: result });
}
