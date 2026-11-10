// A1 proof tool: for every call origin, resolve the call with the Agent
// contract (lib/agent/resolve.ts), project it to today's payload fields
// (lib/agent/legacy-fields.ts) and compare with what the REAL route handlers
// serve. Run against a throwaway Postgres seeded with mock rows (stable ids
// …0a/…0b/…0c accounts, …c1/…c2 agents, …d1/…d2 campaigns, …e1/…e2 contacts):
//   PHONES=+972…,+972… OUT=/tmp/a1.json DATABASE_URL=<throwaway> INTERNAL_SECRET=mock \
//     npx tsx scripts/agent-resolution-check.ts
import { writeFileSync } from "node:fs";
import { NextRequest } from "next/server";

import type { CallOrigin } from "../lib/agent/contract";
import { brickFields, outboundPrompt, receptionistBlocks } from "../lib/agent/legacy-fields";
import { resolveCall } from "../lib/agent/resolve";
import { getCampaignGoalFramings } from "../lib/settings";

const SEP = "\n\n──────────────────────────────────────────\n\n";
const id = (suffix: string) => `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;

async function main() {
  const H = { "x-internal-secret": process.env.INTERNAL_SECRET! };
  const { GET: config } = await import("../app/api/agent/config/route");
  const { GET: camp } = await import("../app/api/agent/campaign-config/route");
  const { GET: otest } = await import("../app/api/agent/outbound-test-config/route");
  const framings = await getCampaignGoalFramings();
  const results: Array<Record<string, unknown>> = [];

  const check = async (name: string, origin: CallOrigin, url: string, handler: (r: NextRequest) => Promise<Response>) => {
    const res = await handler(new NextRequest(url, { headers: H }));
    const route = await res.json();
    const r = await resolveCall(origin);
    if (!r.ok) {
      const same = "external" in r ? null : r.status === res.status && r.error === route.error;
      results.push({ name, routeStatus: res.status, routeError: route.error, resolution: r, same });
      return;
    }
    const fields = brickFields(r.resolved) as Record<string, unknown>;
    const mismatched = Object.keys(fields).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(route[k]));
    let promptOk: boolean;
    if (r.resolved.agent.recipe === "receptionist") {
      const blocks = String(route.instructions).split(SEP);
      promptOk = Object.values(receptionistBlocks(r.resolved)).every((b) => !b || blocks.includes(b));
    } else {
      const p = outboundPrompt(r.resolved, { framings, accountSheet: null });
      promptOk = p.instructions === route.instructions && p.greetingInstructions === route.greetingInstructions;
    }
    results.push({ name, routeStatus: res.status, fieldsChecked: Object.keys(fields).length, mismatched, promptOk });
  };

  for (const u of ["a", "b", "c"]) {
    await check(`web ${u}`, { kind: "web", userId: id(u) }, `http://l/x?userId=${id(u)}`, config);
    await check(`call_me ${u}`, { kind: "call_me", userId: id(u) }, `http://l/x?userId=${id(u)}`, config);
  }
  for (const ph of (process.env.PHONES ?? "").split(",").filter(Boolean)) {
    await check(`phone …${ph.slice(-3)}`, { kind: "phone", calledNumber: ph }, `http://l/x?phone=${encodeURIComponent(ph)}`, config);
  }
  await check("phone unknown", { kind: "phone", calledNumber: "+97229999999" }, "http://l/x?phone=%2B97229999999", config);
  for (const [c, k] of [["d1", "e1"], ["d2", "e2"]]) {
    await check(`campaign ${c}`, { kind: "campaign", campaignId: id(c), contactId: id(k) }, `http://l/x?campaignId=${id(c)}&contactId=${id(k)}`, camp);
  }
  await check("campaign missing", { kind: "campaign", campaignId: id("ff"), contactId: id("e1") }, `http://l/x?campaignId=${id("ff")}&contactId=${id("e1")}`, camp);
  for (const a of ["c1", "c2"]) {
    await check(`outbound_test ${a}`, { kind: "outbound_test", agentId: id(a) }, `http://l/x?agentId=${id(a)}`, otest);
  }
  await check("outbound_test missing", { kind: "outbound_test", agentId: id("fe") }, `http://l/x?agentId=${id("fe")}`, otest);
  results.push({ name: "vox", resolution: await resolveCall({ kind: "vox", calledNumber: "+97220000000" }) });
  writeFileSync(process.env.OUT!, JSON.stringify(results, null, 1));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
