// Raw-bytes route snapshot (T4 proof): calls the REAL config route handlers —
// the 3 legacy routes and /api/agent/session-config for every origin —
// against a throwaway Postgres seeded with mock rows, and writes each
// response's status + raw body text (`res.text()`, only "updatedAt" masked).
// Run it on main and on a branch, then compare the files byte for byte.
//   SNAP_OUT=/tmp/x.json DATABASE_URL=<throwaway db> INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts
// Mock ids/numbers: …0a/…0b/…0c accounts, …c1/…c2/…c3 agents (…c3 has a
// stored mission), …d1–…d9 campaigns (one per goal preset + an unknown one,
// M2a), …e1–…e9 contacts, +97220000000/+97220000001.
// Seed: scripts/fixtures/mission-m2a-seed.sql (mock only).
import { NextRequest } from "next/server";

const id = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;
const mask = (t: string) => t.replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"*"');

async function main() {
  const H = { "x-internal-secret": process.env.INTERNAL_SECRET! };
  const routes = {
    config: (await import("../app/api/agent/config/route")).GET,
    campaign: (await import("../app/api/agent/campaign-config/route")).GET,
    otest: (await import("../app/api/agent/outbound-test-config/route")).GET,
    session: (await import("../app/api/agent/session-config/route")).GET,
  };
  const cases: Array<[string, keyof typeof routes, string]> = [
    ["config phone a", "config", "phone=%2B97220000000&caller=%2B33600000000"],
    ["config phone c", "config", "phone=%2B97220000001"],
    ["config web a", "config", `userId=${id("a")}`],
    ["config web b", "config", `userId=${id("b")}`],
    ["campaign d1", "campaign", `campaignId=${id("d1")}&contactId=${id("e1")}`],
    ["campaign d2", "campaign", `campaignId=${id("d2")}&contactId=${id("e2")}`],
    ["campaign missing", "campaign", `campaignId=${id("ff")}&contactId=${id("e1")}`],
    ["otest c1", "otest", `agentId=${id("c1")}`],
    ["otest c2", "otest", `agentId=${id("c2")}`],
    ["otest missing", "otest", `agentId=${id("ff")}`],
    ["session phone a", "session", "origin=phone&phone=%2B97220000000&caller=%2B33600000000"],
    ["session phone c", "session", "origin=phone&phone=%2B97220000001"],
    ["session web a", "session", `origin=web&userId=${id("a")}`],
    ["session web b", "session", `origin=web&userId=${id("b")}`],
    ["session call_me a", "session", `origin=call_me&userId=${id("a")}`],
    ["session campaign d1", "session", `origin=campaign&campaignId=${id("d1")}&contactId=${id("e1")}`],
    ["session campaign d2", "session", `origin=campaign&campaignId=${id("d2")}&contactId=${id("e2")}`],
    ["session outbound_test c1", "session", `origin=outbound_test&agentId=${id("c1")}`],
    ["session outbound_test c2", "session", `origin=outbound_test&agentId=${id("c2")}`],
    // M2a: one campaign per goal preset (+ an unknown stored preset, + an
    // agent with a stored mission), legacy route and session-config mirror.
    ...(["d3", "d4", "d5", "d6", "d7", "d8", "d9"].flatMap((d) => {
      const q = `campaignId=${id(d)}&contactId=${id(`e${d.slice(1)}`)}`;
      return [
        [`campaign ${d}`, "campaign", q],
        [`session campaign ${d}`, "session", `origin=campaign&${q}`],
      ];
    }) as Array<[string, keyof typeof routes, string]>),
    ["otest c3", "otest", `agentId=${id("c3")}`],
    ["session outbound_test c3", "session", `origin=outbound_test&agentId=${id("c3")}`],
  ];
  const out: Record<string, { status: number; text: string }> = {};
  for (const [name, route, q] of cases) {
    const res = await routes[route](new NextRequest(`http://localhost/x?${q}`, { headers: H }));
    out[name] = { status: res.status, text: mask(await res.text()) };
  }
  // The instructions preview (/api/dashboard/agent-instructions-preview):
  // the route needs a signed-in session, so its two shapes are built here
  // from the SAME functions it calls (the route file itself is unchanged).
  const { loadOutboundTestInstructionsInput, loadInboundInstructionsInput } = await import("../lib/agent/session-instructions-load");
  const { outboundSessionInstructions, inboundSessionInstructions, inboundTenantSections } = await import("../lib/agent/session-instructions");
  const { resolveTenantByUserId } = await import("../lib/tenant");
  for (const [agent, account] of [["c1", "a"], ["c2", "b"], ["c3", "a"], ["c3", "b"]]) {
    const o = await loadOutboundTestInstructionsInput(id(agent), id(account));
    out[`preview outbound ${agent} as ${account}`] = {
      status: o ? 200 : 404,
      text: JSON.stringify(
        o
          ? {
              admin: { scope: "full", instructions: outboundSessionInstructions(o.input), greeting: o.greeting },
              tenant: { scope: "tenant", parts: { greeting: o.greeting, companySheet: o.knowledge, instructions: o.agentInstructions } },
            }
          : { error: "agent_not_found" },
      ),
    };
  }
  for (const account of ["a", "b"]) {
    const tenant = await resolveTenantByUserId(id(account));
    if (!tenant) { out[`preview inbound ${account}`] = { status: 404, text: "" }; continue; }
    const { input, greeting } = await loadInboundInstructionsInput(tenant);
    const own = inboundTenantSections(input);
    out[`preview inbound ${account}`] = {
      status: 200,
      text: JSON.stringify({
        admin: { scope: "full", instructions: inboundSessionInstructions(input), greeting },
        tenant: { scope: "tenant", parts: { greeting, companySheet: own.companySheet, instructions: own.instructions } },
      }),
    };
  }
  (await import("node:fs")).writeFileSync(process.env.SNAP_OUT!, JSON.stringify(out, null, 1));
  console.log(`${Object.keys(out).length} responses → ${process.env.SNAP_OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
