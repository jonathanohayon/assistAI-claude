// "Prévenez-moi" on a "soon" product page (lib/notify-me.ts and the
// NotifyMeView block of components/dashboard/ProductPreviewHeader.tsx):
// the POST (URL, body; tenant and admin asUserId), the outcome of each
// status, the one-request-at-a-time guard, and what each phase renders.
// Mock fetch only: no network, no database.
// Run with:  npx tsx scripts/tests/notify-me.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotifyMeView } from "../../components/dashboard/ProductPreviewHeader";
import { notifyOutcome, notifySubmitter, notifyUrl, postNotify, type NotifyFetch, type NotifyPhase } from "../../lib/notify-me";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function mockFetch(status: number | "throw", calls: Call[]): NotifyFetch {
  return async (url, init) => {
    calls.push({ url, ...init });
    if (status === "throw") throw new TypeError("network down");
    return { status };
  };
}

async function main() {
  // ── 1. URL and body: tenant, then admin ?asUserId ───────────────────────
  {
    assert.equal(notifyUrl(), "/api/dashboard/products/notify");
    assert.equal(notifyUrl(null), "/api/dashboard/products/notify");
    assert.equal(notifyUrl("u-1&x=2"), "/api/dashboard/products/notify?asUserId=u-1%26x%3D2", "asUserId is encoded");

    const calls: Call[] = [];
    assert.equal(await postNotify("sales", undefined, mockFetch(201, calls)), "done");
    assert.deepEqual(calls, [
      { url: "/api/dashboard/products/notify", method: "POST", headers: { "Content-Type": "application/json" }, body: '{"product":"sales"}' },
    ]);
    const admin: Call[] = [];
    await postNotify("connect", "00000000-0000-4000-8000-000000000abc", mockFetch(201, admin));
    assert.equal(admin[0].url, "/api/dashboard/products/notify?asUserId=00000000-0000-4000-8000-000000000abc");
    assert.equal(admin[0].body, '{"product":"connect"}');
  }

  // ── 2. Each status's outcome ────────────────────────────────────────────
  {
    const outcome = async (s: number | "throw") => postNotify("sales", null, mockFetch(s, []));
    assert.equal(await outcome(201), "done", "201: stored");
    assert.equal(await outcome(200), "done", "200: already stored (idempotent)");
    assert.equal(await outcome(409), "gone", "409: product owned, show nothing");
    assert.equal(await outcome(400), "error", "400: inline error");
    assert.equal(await outcome(404), "error", "404: inline error");
    assert.equal(await outcome(401), "error");
    assert.equal(await outcome(403), "error");
    assert.equal(await outcome(500), "error");
    assert.equal(await outcome("throw"), "error", "network error: inline error");
    assert.equal(notifyOutcome(204), "error", "only 200 and 201 are success");
  }

  // ── 3. No double submit ─────────────────────────────────────────────────
  {
    const calls: Call[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowFetch: NotifyFetch = async (url, init) => {
      calls.push({ url, ...init });
      await gate;
      return { status: 201 };
    };
    const submit = notifySubmitter(() => postNotify("sales", null, slowFetch));
    const first = submit();
    const second = submit();
    const third = submit();
    assert.equal(calls.length, 1, "one POST for three clicks");
    release();
    assert.equal(await second, null, "a click while pending sends nothing");
    assert.equal(await third, null);
    assert.equal(await first, "done");
    assert.equal(calls.length, 1, "still one POST once settled");
    // After an error the button stays and a new click sends again.
    const errCalls: Call[] = [];
    const retry = notifySubmitter(() => postNotify("sales", null, mockFetch(400, errCalls)));
    assert.equal(await retry(), "error");
    assert.equal(await retry(), "error");
    assert.equal(errCalls.length, 2, "settled: the next click is a new request");
  }

  // ── 4. What each phase renders ──────────────────────────────────────────
  {
    const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
    const q = (x: string) => x.replace(/'/g, "&#x27;");
    for (const locale of ["fr", "en", "he"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      const m = messages.DashboardNav;
      const view = (phase: NotifyPhase) =>
        renderToStaticMarkup(createElement(Intl, { locale, messages, timeZone: "UTC" }, createElement(NotifyMeView, { phase })));
      const buttons = (h: string) => (h.match(/<button\b/g) ?? []).length;

      const idle = view("idle");
      assert.equal(buttons(idle), 1, `${locale}: idle = one button`);
      assert.ok(idle.includes(q(m.previewNotify)));
      assert.doesNotMatch(idle, / disabled=""| aria-busy=|role="alert"/);

      const pending = view("pending");
      assert.equal(buttons(pending), 1, `${locale}: pending = the button`);
      assert.match(pending, /<button[^>]* disabled=""[^>]* aria-busy="true"/, `${locale}: pending = disabled + aria-busy`);

      const done = view("done");
      assert.equal(buttons(done), 0, `${locale}: 201/200 = no button`);
      assert.ok(done.includes(q(m.previewNotified)), `${locale}: 201/200 = the "noted" line`);

      assert.equal(view("gone"), "", `${locale}: 409 = nothing shown`);

      const error = view("error");
      assert.equal(buttons(error), 1, `${locale}: error = the button stays`);
      assert.doesNotMatch(error, / disabled=""/, `${locale}: error = clickable again`);
      assert.match(error, new RegExp(`role="alert">${q(m.previewNotifyError).replace(/[.?*+()]/g, "\\$&")}<`), `${locale}: error = an inline alert`);
      assert.ok(!error.includes(q(m.previewNotified)));
    }
  }

  // ── 5. The header wires them: the guard, the outcome, the initial state ─
  {
    const src = readFileSync("components/dashboard/ProductPreviewHeader.tsx", "utf8");
    assert.match(src, /useState<NotifyPhase>\(notifyRequested \? "done" : "idle"\)/, "already requested: the line from the first render");
    assert.match(src, /useState\(\(\) => notifySubmitter\(\(\) => postNotify\(entry, asUserId\)\)\)/, "one guarded submitter per header");
    assert.match(src, /if \(outcome\) setPhase\(outcome\);/, "an ignored double click leaves the phase alone");
    // The client helper stays client-safe (no db, no env).
    const lib = readFileSync("lib/notify-me.ts", "utf8");
    assert.doesNotMatch(lib, /@\/lib\/db|from "\.\/db|process\.env/);
    assert.doesNotMatch(lib.replace(/^import type .*$/gm, ""), /^import /m, "type-only imports");
  }

  console.log("notify-me: OK");
  finished = true;
}

// A promise left pending would end the process with code 0 without
// reaching the end: fail instead.
let finished = false;
process.on("exit", (code) => {
  if (code === 0 && !finished) {
    console.error("notify-me: did not run to the end");
    process.exitCode = 1;
  }
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
