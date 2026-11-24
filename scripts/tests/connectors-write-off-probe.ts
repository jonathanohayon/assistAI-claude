// B4 invariant probe (run by scripts/connectors-write-db.sh ONLY, between two
// worker payload snapshots): with CONNECTORS_WRITE unset, calls EVERY
// connector write route (POST, PATCH, test; B4 has no DELETE) — as each
// seeded account on its own scope and as the mock admin via ?asUserId — and
// asserts 404 connectors_write_off. The script then proves the payload bytes
// identical. Mock seed only; a
// 127.0.0.1/localhost URL only.
import assert from "node:assert/strict";

const url = process.env.CONNECTORS_WRITE_OFF_PROBE_URL;
if (!url) {
  console.log("skip: connectors write-off probe (no CONNECTORS_WRITE_OFF_PROBE_URL — see scripts/connectors-write-db.sh)");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local database host ${host}`);
if (process.env.CONNECTORS_WRITE !== undefined) throw new Error("CONNECTORS_WRITE must be unset for this probe");
if (!(globalThis as { __connectorsWriteHooks?: boolean }).__connectorsWriteHooks) throw new Error("module hooks missing");
process.env.DATABASE_URL = url;
globalThis.fetch = (async () => {
  throw new Error("test: no network");
}) as typeof fetch;

const g = globalThis as { __campgateSession?: { user: { id: string } } | null };
const ADMIN = "00000000-0000-0000-0000-0000000000ad";

async function main() {
  const { sql } = await import("drizzle-orm");
  const { NextRequest } = await import("next/server");
  const { db } = await import("../../lib/db");
  const collection = await import("../../app/api/dashboard/connectors/route");
  const item = await import("../../app/api/dashboard/connectors/[id]/route");
  const testRoute = await import("../../app/api/dashboard/connectors/[id]/test/route");
  const res = (await db.execute(sql`SELECT u.id AS uid, p.id AS pid FROM users u LEFT JOIN phone_numbers p ON p.user_id = u.id WHERE u.id <> ${ADMIN} ORDER BY u.id`)) as unknown as Array<{ uid: string; pid: string | null }>;
  const fake = "00000000-0000-4000-8000-000000000c01";
  let calls = 0;
  for (const { uid, pid } of res) {
    for (const [who, qs] of [[uid, ""], [ADMIN, `?asUserId=${uid}`]] as const) {
      g.__campgateSession = { user: { id: who } };
      const body = { name: "Probe", url: "https://probe.example.com/hook", mode: "lead", phoneNumberId: pid ?? fake, acknowledgeLegacyConversion: true };
      const mk = (path: string, method: string, b?: unknown) =>
        new NextRequest(`http://localhost${path}${qs}`, { method, ...(b === undefined ? {} : { body: JSON.stringify(b), headers: { "content-type": "application/json" } }) });
      const ctx = (cid: string) => ({ params: Promise.resolve({ id: cid }) });
      for (const cid of ["legacy", fake]) {
        const out = [
          await collection.POST(mk("/api/dashboard/connectors", "POST", body)),
          await item.PATCH(mk(`/api/dashboard/connectors/${cid}`, "PATCH", { name: "Probe", rotateSecret: true, acknowledgeLegacyConversion: true }), ctx(cid)),
          await testRoute.POST(mk(`/api/dashboard/connectors/${cid}/test`, "POST", {}), ctx(cid)),
        ];
        for (const r of out) {
          assert.deepEqual([r.status, await r.json()], [404, { error: "connectors_write_off" }]);
          calls++;
        }
      }
    }
  }
  assert.equal(Number(((await db.execute(sql`SELECT count(*)::int AS n FROM connectors`)) as unknown as Array<{ n: number }>)[0].n), 0, "no connector written");
  console.log(`probe: ${calls} write calls with CONNECTORS_WRITE unset, all 404 connectors_write_off`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
