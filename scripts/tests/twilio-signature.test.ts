// Unit tests for lib/twilio-signature.ts.
// Run with:  npx tsx scripts/tests/twilio-signature.test.ts

import assert from "node:assert/strict";

import {
  candidateUrls,
  isValidTwilioSignature,
  twilioSignature,
} from "../../lib/twilio-signature";

// matches the official SDK (twilio@5.3.0 getExpectedTwilioSignature) on the docs example inputs
{
  const token = "12345";
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  };
  assert.equal(twilioSignature(token, url, params), "vNe7KK2kJwCsxc9K3OLkkKB3qqI=");
}

// accepts a request signed for one of the candidate URLs, rejects tampering
{
  const params = { To: "whatsapp:+97223764700", From: "whatsapp:+972501234567" };
  const url = "https://aitamara.com/api/twilio/voice-bridge";
  const sig = twilioSignature("tok", url, params);
  // same value the official SDK computes for these inputs
  assert.equal(sig, "FwOSs7307Oicygt5fsZHO+zHVro=");
  const urls = ["https://internal:8080/api/twilio/voice-bridge", url];
  assert.equal(isValidTwilioSignature({ authToken: "tok", signature: sig, urls, params }), true);
  assert.equal(
    isValidTwilioSignature({ authToken: "tok", signature: sig, urls, params: { ...params, To: "+1" } }),
    false,
  );
  assert.equal(isValidTwilioSignature({ authToken: "tok", signature: null, urls, params }), false);
  assert.equal(isValidTwilioSignature({ authToken: "", signature: sig, urls, params }), false);
}

// rebuilds the public URL from APP_URL and forwarded headers, never the internal port
{
  const h = new Headers({ "x-forwarded-host": "aitamara.com:8080", "x-forwarded-proto": "https" });
  assert.deepEqual(candidateUrls("/api/twilio/voice-bridge", h, "https://aitamara.com/"), [
    "https://aitamara.com/api/twilio/voice-bridge",
  ]);
}

console.log("ALL TWILIO-SIGNATURE TESTS PASSED");
