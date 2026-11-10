// A3 proof tool: the single route /api/agent/session-config must serve, for
// every origin, the old route's response EXACTLY (same status, same JSON in
// the same key order) plus `session` = resolveCall(origin). Run against a
// throwaway Postgres seeded with mock rows (…0a/…0b/…0c accounts, …c1/…c2
// agents, …d1/…d2 campaigns, …e1/…e2 contacts, +97220000000/+97220000001):
//   DATABASE_URL=<throwaway> INTERNAL_SECRET=mock npx tsx scripts/session-config-check.ts
import { NextRequest } from "next/server";

import type { CallOrigin } from "../lib/agent/contract";
import { resolveCall } from "../lib/agent/resolve";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
// The outbound routes stamp updatedAt with the request time.
const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/, '"updatedAt":"*"');

async function main() {
  const H = { "x-internal-secret": process.env.INTERNAL_SECRET! };
  const { GET: single } = await import("../app/api/agent/session-config/route");
  const { GET: config } = await import("../app/api/agent/config/route");
  const { GET: camp } = await import("../app/api/agent/campaign-config/route");
  const { GET: otest } = await import("../app/api/agent/outbound-test-config/route");
  const get = async (h: (r: NextRequest) => Promise<Response>, q: string) => {
    const res = await h(new NextRequest(`http://localhost/x?${q}`, { headers: H }));
    return { status: res.status, text: await res.text() };
  };
  let failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failed++;
  };

  const cases: Array<[string, CallOrigin | null, string, (r: NextRequest) => Promise<Response>, string]> = [
    ["phone a", { kind: "phone", calledNumber: "+97220000000" }, "origin=phone&phone=%2B97220000000&caller=%2B33600000000", config, "phone=%2B97220000000&caller=%2B33600000000"],
    ["phone c", { kind: "phone", calledNumber: "+97220000001" }, "origin=phone&phone=%2B97220000001", config, "phone=%2B97220000001"],
    ["phone unknown", null, "origin=phone&phone=%2B97229999999", config, "phone=%2B97229999999"],
    ...(["a", "b", "c"].flatMap((u) => [
      [`web ${u}`, { kind: "web", userId: id(u) }, `origin=web&userId=${id(u)}`, config, `userId=${id(u)}`],
      [`call_me ${u}`, { kind: "call_me", userId: id(u) }, `origin=call_me&userId=${id(u)}`, config, `userId=${id(u)}`],
    ]) as typeof cases),
    ["web missing user (fallback)", { kind: "web", userId: id("99") }, `origin=web&userId=${id("99")}`, config, `userId=${id("99")}`],
    ["campaign d1", { kind: "campaign", campaignId: id("d1"), contactId: id("e1") }, `origin=campaign&campaignId=${id("d1")}&contactId=${id("e1")}`, camp, `campaignId=${id("d1")}&contactId=${id("e1")}`],
    ["campaign d2", { kind: "campaign", campaignId: id("d2"), contactId: id("e2") }, `origin=campaign&campaignId=${id("d2")}&contactId=${id("e2")}`, camp, `campaignId=${id("d2")}&contactId=${id("e2")}`],
    ["campaign missing", null, `origin=campaign&campaignId=${id("ff")}&contactId=${id("e1")}`, camp, `campaignId=${id("ff")}&contactId=${id("e1")}`],
    ["outbound_test c1", { kind: "outbound_test", agentId: id("c1") }, `origin=outbound_test&agentId=${id("c1")}`, otest, `agentId=${id("c1")}`],
    ["outbound_test c2", { kind: "outbound_test", agentId: id("c2") }, `origin=outbound_test&agentId=${id("c2")}`, otest, `agentId=${id("c2")}`],
    ["outbound_test missing", null, `origin=outbound_test&agentId=${id("ff")}`, otest, `agentId=${id("ff")}`],
  ];

  for (const [name, origin, q, legacyHandler, legacyQ] of cases) {
    const n = await get(single, q);
    const o = await get(legacyHandler, legacyQ);
    if (n.status !== 200) {
      ok(name, n.status === o.status && n.text === o.text, `${n.status} vs legacy ${o.status}`);
      continue;
    }
    const { session, ...legacy } = JSON.parse(n.text);
    ok(`${name}: legacy part`, n.status === o.status && mask(JSON.stringify(legacy)) === mask(o.text));
    const r = await resolveCall(origin!, { reportFallback: false });
    if (!r.ok) { ok(`${name}: session`, false, "resolveCall failed"); continue; }
    const { legacyKnowledge: _lk, ...account } = r.resolved.account;
    void _lk;
    ok(`${name}: session`, JSON.stringify(session) === JSON.stringify({ version: 1, agent: r.resolved.agent, account, call: r.resolved.call }),
      `${session.agent.recipe}, ${Object.keys(session).join("/")}`);
  }

  for (const [name, q, error] of [
    ["vox", "origin=vox&phone=%2B97220000000", "external_origin"],
    ["no origin", "phone=%2B97220000000", "unknown_origin"],
    ["phone + userId", `origin=phone&phone=%2B97220000000&userId=${id("a")}`, "bad_origin_params"],
    ["web without userId", "origin=web", "bad_origin_params"],
    ["campaign without contact", `origin=campaign&campaignId=${id("d1")}`, "bad_origin_params"],
  ] as const) {
    const n = await get(single, q);
    ok(`refuse ${name}`, n.status === 400 && JSON.parse(n.text).error === error, n.text);
  }
  const bad = await single(new NextRequest("http://localhost/x?origin=web&userId=x", { headers: { "x-internal-secret": "nope" } }));
  ok("refuse bad secret", bad.status === 401);

  console.log(failed ? `${failed} FAILED` : "ALL SESSION-CONFIG CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
