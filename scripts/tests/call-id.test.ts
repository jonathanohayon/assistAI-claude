// Call id on tool events (lib/call-id.ts, lib/call-end-body.ts). Mock values.
// Run with:  npx tsx scripts/tests/call-id.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { callIdFromRequest, callIdMeta, parseCallId } from "../../lib/call-id";
import { parseCallEndBody } from "../../lib/call-end-body";

const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

// LiveKit room names as the worker sends them
assert.equal(parseCallId("_+972500000000_AbC123"), "_+972500000000_AbC123");
assert.equal(parseCallId("campaign__c-1__k-1__2"), "campaign__c-1__k-1__2");
assert.equal(parseCallId(""), null);
assert.equal(parseCallId("a b"), null); // no spaces
assert.equal(parseCallId("x".repeat(129)), null);
assert.equal(parseCallId("'; drop table events; --"), null);
assert.equal(parseCallId(42), null);

assert.equal(callIdFromRequest(req({ "x-call-id": "room-1" })), "room-1");
assert.equal(callIdFromRequest(req({})), null);
// metadata never gets a null key
assert.deepEqual(callIdMeta(req({ "x-call-id": "room-1" })), { callId: "room-1" });
assert.deepEqual(callIdMeta(req({})), {});
assert.deepEqual(callIdMeta(req({ "x-call-id": "bad id" })), {});

// call end body: new field, absent for older workers
assert.equal(parseCallEndBody({ callId: "room-1" }).callId, "room-1");
assert.equal(parseCallEndBody({}).callId, null);

const sql = readFileSync(new URL("../../drizzle/0039_call_id.sql", import.meta.url), "utf8");
assert.match(sql, /ADD COLUMN IF NOT EXISTS "call_id"/);
assert.match(sql, /CREATE INDEX IF NOT EXISTS "events_call_id_idx"/);

console.log("ALL CALL-ID TESTS PASSED");
