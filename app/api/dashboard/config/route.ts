import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import {
  REALTIME_MODELS,
  voicesFor,
} from "@/lib/realtime";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  if (!config) {
    return NextResponse.json({ error: "No config" }, { status: 404 });
  }

  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    instructions: string;
    greetingInstructions: string;
    model: string;
    voice: string;
    temperature: number;
    speed: number;
    maxResponseTokens: number;
  }>;

  // Validate model + voice against the catalog so the user can't ship a typo
  // into the agent config.
  const modelIds = REALTIME_MODELS.map((m) => m.id);
  if (body.model && !modelIds.includes(body.model)) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }
  if (body.model && body.voice && !voicesFor(body.model).includes(body.voice)) {
    return NextResponse.json(
      { error: "Voice not supported by this model" },
      { status: 400 },
    );
  }

  const updates: Partial<typeof agentConfigs.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.instructions != null) updates.instructions = body.instructions;
  if (body.greetingInstructions != null)
    updates.greetingInstructions = body.greetingInstructions;
  if (body.model != null) updates.model = body.model;
  if (body.voice != null) updates.voice = body.voice;
  if (body.temperature != null)
    updates.temperature = clamp(body.temperature, 0, 1.5);
  if (body.speed != null) updates.speed = clamp(body.speed, 0.5, 1.5);
  if (body.maxResponseTokens != null)
    updates.maxResponseTokens = Math.round(
      clamp(body.maxResponseTokens, 50, 4000),
    );

  const [updated] = await db
    .update(agentConfigs)
    .set(updates)
    .where(eq(agentConfigs.userId, session.user.id))
    .returning();

  return NextResponse.json(updated);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
