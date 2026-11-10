// Route snapshot for the Voice contract (V2 proof). Calls the REAL config
// route handlers against a throwaway Postgres seeded with mock rows and
// writes their JSON. Run it on main and on a branch, then diff: the branch
// must equal main apart from the added `voiceConfig`.
//   SNAP_OUT=/tmp/x.json DATABASE_URL=<throwaway db> INTERNAL_SECRET=mock npx tsx scripts/voice-route-snapshot.ts
// Mock ids/numbers below must exist in the seeded DB (see the V2 PR body).
import { NextRequest } from "next/server";
async function call(mod: string, url: string) {
  const { GET } = await import(mod);
  const res = await GET(new NextRequest(url, { headers: { "x-internal-secret": process.env.INTERNAL_SECRET! } }));
  const body = await res.json();
  delete body.updatedAt;
  return { status: res.status, body };
}
async function main() {
  const B = "http://localhost";
  const out = {
    inboundDefault: await call("../app/api/agent/config/route", `${B}/api/agent/config?phone=%2B97220000000`),
    inboundProfile: await call("../app/api/agent/config/route", `${B}/api/agent/config?phone=%2B97220000001`),
    inboundWeb: await call("../app/api/agent/config/route", `${B}/api/agent/config?userId=00000000-0000-0000-0000-00000000000b`),
    campaignSliders: await call("../app/api/agent/campaign-config/route", `${B}/api/agent/campaign-config?campaignId=00000000-0000-0000-0000-0000000000d1&contactId=00000000-0000-0000-0000-0000000000e1`),
    campaignNoAgent: await call("../app/api/agent/campaign-config/route", `${B}/api/agent/campaign-config?campaignId=00000000-0000-0000-0000-0000000000d2&contactId=00000000-0000-0000-0000-0000000000e2`),
    outboundTestSliders: await call("../app/api/agent/outbound-test-config/route", `${B}/api/agent/outbound-test-config?agentId=00000000-0000-0000-0000-0000000000c1`),
    outboundTestDefault: await call("../app/api/agent/outbound-test-config/route", `${B}/api/agent/outbound-test-config?agentId=00000000-0000-0000-0000-0000000000c2`),
  };
  (await import("node:fs")).writeFileSync(process.env.SNAP_OUT!, JSON.stringify(out));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
