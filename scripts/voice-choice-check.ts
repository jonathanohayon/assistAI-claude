// V8b proof tool: a voice save through the REAL write path
// (inboundVoiceConfigUpdates, as /api/dashboard/config applies it) on a
// throwaway Postgres seeded with mock rows (+97220000000 = account …0a),
// then what /api/agent/config serves. Run:
//   DATABASE_URL=<throwaway> INTERNAL_SECRET=mock npx tsx scripts/voice-choice-check.ts
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "../lib/db";
import { agentConfigs } from "../lib/db/schema";
import { voicesFor } from "../lib/realtime";
import { catalogueIdFor } from "../lib/voice/catalogue";
import { inboundVoiceConfigUpdates } from "../lib/voice/route-writes";

const A = "00000000-0000-0000-0000-00000000000a";
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');

async function main() {
  const { GET } = await import("../app/api/agent/config/route");
  const served = async () =>
    mask(await (await GET(new NextRequest("http://l/x?phone=%2B97220000000", { headers: { "x-internal-secret": process.env.INTERNAL_SECRET! } }))).text());
  // The route's write: load the row, plan, apply (+ updatedAt, as the route does).
  const save = async (voiceConfig: unknown, isAdmin = false) => {
    const [row] = await db.select().from(agentConfigs).where(eq(agentConfigs.userId, A));
    const w = inboundVoiceConfigUpdates({ voiceConfig }, row, isAdmin, voicesFor);
    if (!w || "error" in w) return w;
    await db.update(agentConfigs).set({ ...w.updates, updatedAt: new Date() } as never).where(eq(agentConfigs.userId, A));
    return w;
  };
  const overrides = async () => (JSON.parse(await served()).voiceProfile?.voiceOverrides ?? {}) as Record<string, string>;

  const [seedRow] = await db.select().from(agentConfigs).where(eq(agentConfigs.userId, A));
  const reset = (realtimeProvider: string | null) =>
    db
      .update(agentConfigs)
      // voiceConfig NULL = derived from the columns (an engine column and a
      // stored voice that disagree is not a state real saves produce).
      .set({ realtimeProvider, voice: seedRow.voice, voiceProfile: seedRow.voiceProfile, voiceConfig: null, noiseReductionLevel: seedRow.noiseReductionLevel } as never)
      .where(eq(agentConfigs.userId, A));
  const diff = (a: string, b: string) => {
    const x = JSON.parse(a), y = JSON.parse(b);
    return Object.keys({ ...x, ...y }).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).join(",");
  };

  // OpenAI account (the seed's account is on Grok: switch it).
  await reset(null);
  const before = await served();
  await save({ noiseReduction: JSON.parse(before).noiseReductionLevel ?? 8 });
  ok("openai: a save that chooses no voice → served bytes identical", (await served()) === before, diff(before, await served()));
  const [r0] = await db.select({ v: agentConfigs.voice }).from(agentConfigs).where(eq(agentConfigs.userId, A));
  const reSend = await save({ voiceId: r0.v });
  ok("openai: re-sending the same voice → identical", !!reSend && !("error" in reSend) && (await served()) === before);
  await save({ voiceId: catalogueIdFor("openai", "cedar") });
  const s1 = JSON.parse(await served());
  ok("openai: choosing a voice by our id → voice column = cedar", s1.voice === "cedar", s1.voice);
  ok("openai: NO per-engine override written", JSON.stringify(await overrides()) === JSON.stringify(JSON.parse(before).voiceProfile?.voiceOverrides ?? {}), JSON.stringify(await overrides()));

  // Grok account (the seed as it is).
  await reset("xai");
  const grokBefore = await served();
  await save({ noiseReduction: 6 });
  await save({ noiseReduction: JSON.parse(grokBefore).noiseReductionLevel });
  ok("xai: saves that choose no voice → served bytes identical", (await served()) === grokBefore, diff(grokBefore, await served()));
  const direct = await save({ advanced: { voiceOverrides: { xai: "ara" } } });
  ok("xai: a tenant's DIRECT override write → 403", !!direct && "error" in direct && direct.error.status === 403, JSON.stringify(direct));
  ok("xai: …and nothing written", (await served()) === grokBefore, diff(grokBefore, await served()));
  await save({ voiceId: catalogueIdFor("xai", "orion") });
  ok("xai: choosing orion by our id → served override xai=orion", (await overrides()).xai === "orion", JSON.stringify(await overrides()));
  const afterChoice = await served();
  await save({ voiceId: catalogueIdFor("xai", "orion") });
  ok("xai: re-sending the same choice → identical", (await served()) === afterChoice);
  await save({ advanced: { voiceOverrides: { xai: "sal" } } }, true);
  ok("xai: an ADMIN's direct override write still works", (await overrides()).xai === "sal");

  console.log(failed ? `${failed} FAILED` : "ALL VOICE-CHOICE CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
