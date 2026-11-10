// V7 Listen: sample list store, admin generation loop, versioned URLs.
// Run with:  npx tsx scripts/tests/voice-listen.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { generateAllSamples, type GenerateProgress, type GenerateResponse } from "../../components/bricks/voice/generate-samples";
import {
  __resetSamples,
  loadSamples,
  markSampleMissing,
  sampleFor,
} from "../../components/bricks/voice/voice-samples-store";
import { samplePlan, sampleUrl, versionedSampleUrl, VOICE_SAMPLE_VERSION } from "../../lib/voice/samples";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function main() {
  // versioned URL: new row (new time) → new URL; same row → same URL
  {
    const k = { voiceId: "cedar", style: "warm", language: "he" } as const;
    const a = versionedSampleUrl(k, new Date("2026-11-10T20:00:00Z"));
    assert.equal(a, `${sampleUrl(k)}?v=${VOICE_SAMPLE_VERSION}.${Date.parse("2026-11-10T20:00:00Z")}`);
    assert.notEqual(a, versionedSampleUrl(k, new Date("2026-11-11T08:00:00Z")));
  }

  // store: only listed samples; empty list → nothing; 404 hides; one shared load
  {
    __resetSamples();
    let calls = 0;
    const f = (async () => {
      calls++;
      return json({ samples: [{ voiceId: "marin", style: "warm", language: "fr", url: "/api/voice/samples/marin/warm/fr?v=1.1" }] });
    }) as unknown as typeof fetch;
    await Promise.all([loadSamples(f), loadSamples(f)]);
    assert.equal(calls, 1);
    assert.equal(sampleFor("marin", "warm", "fr"), "/api/voice/samples/marin/warm/fr?v=1.1");
    assert.equal(sampleFor("marin", "warm", "he"), null, "other language: no button");
    assert.equal(sampleFor("ash", "warm", "fr"), null, "voice without sample: no button");
    markSampleMissing("/api/voice/samples/marin/warm/fr?v=1.1");
    assert.equal(sampleFor("marin", "warm", "fr"), null, "404 hides the button");

    __resetSamples();
    await loadSamples((async () => json({ samples: [] })) as unknown as typeof fetch);
    assert.equal(sampleFor("marin", "warm", "fr"), null, "zero samples: screen without Listen");
    __resetSamples();
    await loadSamples((async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    assert.equal(sampleFor("marin", "warm", "fr"), null, "list failure: no button, no crash");
  }

  // generation loop: runs until all exist, reports progress, safe to re-click
  const TOTAL = samplePlan().length;
  assert.equal(TOTAL, 72);
  const keyOf = (k: { voiceId: string; style: string; language: string }) => `${k.voiceId}/${k.style}/${k.language}`;
  function server(failOnce: Set<string> = new Set(), alwaysFail: Set<string> = new Set()) {
    const have = new Set<string>();
    const posts: number[] = [];
    return {
      have,
      posts,
      existing: async () => new Set(have),
      post: async () => {
        const missing = samplePlan().filter((k) => !have.has(keyOf(k)));
        const batch = missing.slice(0, 6);
        const body: GenerateResponse = { generated: 0, failed: [], remaining: missing.length - batch.length };
        for (const k of batch) {
          const id = keyOf(k);
          if (alwaysFail.has(id) || failOnce.delete(id)) {
            body.failed.push({ ...k, error: "mock render error" });
            body.remaining++;
          } else {
            have.add(id);
            body.generated++;
          }
        }
        posts.push(body.generated);
        return { ok: true, status: 200, body };
      },
    };
  }
  {
    const s = server(new Set(["marin/warm/fr"]));
    const seen: GenerateProgress[] = [];
    const end = await generateAllSamples({ total: TOTAL, existing: s.existing, post: s.post, onProgress: (p) => seen.push(p) });
    assert.equal(end.status, "done");
    assert.equal(end.done, 72);
    assert.deepEqual(end.failed, [], "a failure retried later and generated is cleared");
    assert.ok(seen.some((p) => p.status === "running" && p.failed.length === 1), "the failure was shown while it lasted");
    assert.ok(seen.map((p) => p.done).every((d, i, a) => i === 0 || d >= a[i - 1]), "progress only goes up");
    // re-click when everything exists: one pass, nothing generated, done
    const again = await generateAllSamples({ total: TOTAL, existing: s.existing, post: s.post, onProgress: () => {} });
    assert.equal(again.status, "done");
    assert.equal(s.have.size, 72);
  }
  {
    // a sample that always fails: the loop stops instead of spinning, lists it
    const bad = "ash/calm/he";
    const s = server(new Set(), new Set([bad]));
    const end = await generateAllSamples({ total: TOTAL, existing: s.existing, post: s.post, onProgress: () => {} });
    assert.equal(end.status, "stuck");
    assert.equal(end.done, 71);
    assert.deepEqual(end.failed.map(keyOf), [bad]);
    assert.ok(s.posts.length < 20, "bounded number of calls");
  }
  {
    const end = await generateAllSamples({
      total: TOTAL,
      existing: async () => new Set(),
      post: async () => ({ ok: false, status: 403, body: null }),
      onProgress: () => {},
    });
    assert.equal(end.status, "error");
    assert.equal(end.error, "HTTP 403");
  }

  // copy: admin-only namespace; no supplier name in the brick's sample code
  for (const l of ["en", "fr", "he"]) {
    const a = JSON.parse(readFileSync(new URL(`../../messages/${l}.json`, import.meta.url), "utf8")).AdminVoiceProfile;
    for (const k of ["samplesTitle", "samplesCount", "samplesGenerate", "samplesRunning", "samplesDone", "samplesStuck", "samplesError"]) assert.ok(a[k], `${l}: ${k}`);
  }
  for (const f of ["components/bricks/voice/voice-samples-store.ts", "components/bricks/voice/use-voice-samples.ts", "components/bricks/voice/generate-samples.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"), /openai|grok|gemini|xai|realtime/i, f);
  }

  console.log("ALL VOICE-LISTEN TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
