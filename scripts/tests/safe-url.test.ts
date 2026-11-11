// Unit tests for the outbound URL guard (lib/net/safe-url.ts) and the legacy
// agent webhook decisions (lib/agent-brain-guard.ts). DNS is an injected
// resolver and HTTP an injected transport: NO real network.
// Run with:  npx tsx scripts/tests/safe-url.test.ts
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { agentBrainSaveDecision, brainView, servedAgentWebhook, urlToSave } from "../../lib/agent-brain-guard";
import {
  checkAgentUrl,
  guardedLookup,
  isBlockedAddress,
  SAFE_URL_MESSAGE,
  safeFetch,
  SafeUrlError,
  type ResolvedAddress,
  type Resolver,
  type Transport,
} from "../../lib/net/safe-url";

const PUBLIC4 = "93.184.215.14";
const PUBLIC6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c";
const v = (address: string): ResolvedAddress => ({ address, family: address.includes(":") ? 6 : 4 });
const resolverOf = (map: Record<string, string[]>): Resolver => async (h) => {
  if (!(h in map)) throw new Error("ENOTFOUND");
  return map[h].map(v);
};
const publicResolver = resolverOf({ "agent.example.com": [PUBLIC4, PUBLIC6] });

async function code(url: string, resolver: Resolver = publicResolver): Promise<string> {
  const r = await checkAgentUrl(url, { resolver });
  return r.ok ? "ok" : r.code;
}

async function run(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

async function main() {
  // ── Blocked address classes (literals and resolved) ─────────────────
  const blocked: Array<[string, string[]]> = [
    ["private 10/8", ["10.0.0.1", "10.255.255.255"]],
    ["private 172.16/12", ["172.16.0.1", "172.31.255.254"]],
    ["private 192.168/16", ["192.168.1.1"]],
    ["unique local fc00::/7", ["fc00::1", "fd12:3456::1"]],
    ["loopback 127/8", ["127.0.0.1", "127.8.9.10"]],
    ["loopback ::1", ["::1", "0:0:0:0:0:0:0:1"]],
    ["link-local 169.254/16", ["169.254.1.1"]],
    ["link-local fe80::/10", ["fe80::1", "febf::1"]],
    ["cloud metadata", ["169.254.169.254", "fd00:ec2::254"]],
    ["unspecified 0.0.0.0/8", ["0.0.0.0", "0.1.2.3", "::"]],
    ["broadcast", ["255.255.255.255"]],
    ["CGNAT 100.64/10", ["100.64.0.1", "100.127.255.255"]],
    ["multicast", ["224.0.0.1", "239.255.255.250", "ff02::1"]],
    ["IPv4-mapped IPv6 of blocked", ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:192.168.0.1"]],
    ["NAT64 / 6to4 of blocked", ["64:ff9b::7f00:1", "2002:7f00:1::1"]],
  ];
  for (const [cls, ips] of blocked) {
    await run(`blocks ${cls}`, async () => {
      for (const ip of ips) {
        assert.equal(isBlockedAddress(ip), true, ip);
        const lit = ip.includes(":") ? `https://[${ip}]/hook` : `https://${ip}/hook`;
        assert.equal(await code(lit), "blocked_address", `literal ${ip}`);
        assert.equal(await code("https://agent.example.com/hook", resolverOf({ "agent.example.com": [ip] })), "blocked_address", `resolved ${ip}`);
      }
    });
  }
  await run("allows public addresses", async () => {
    for (const ip of [PUBLIC4, "8.8.8.8", "1.1.1.1", PUBLIC6, "::ffff:8.8.8.8", "100.128.0.1", "172.32.0.1"]) assert.equal(isBlockedAddress(ip), false, ip);
    assert.equal(await code("https://agent.example.com/hook"), "ok");
    assert.equal(await code(`https://${PUBLIC4}/hook`), "ok");
  });
  await run("one private record among public ones is enough to refuse", async () => {
    assert.equal(await code("https://agent.example.com/x", resolverOf({ "agent.example.com": [PUBLIC4, "10.0.0.5"] })), "blocked_address");
  });
  await run("WHATWG-normalised IPv4 tricks are caught", async () => {
    for (const u of ["https://2130706433/", "https://0x7f.1/", "https://017700000001/", "https://127.1/"]) assert.equal(await code(u), "blocked_address", u);
  });

  // ── Names ───────────────────────────────────────────────────────────
  await run("blocks internal hostnames", async () => {
    for (const u of [
      "https://localhost/x",
      "https://LOCALHOST./x",
      "https://api.localhost/x",
      "https://metadata.google.internal/x",
      "https://web.railway.internal/x",
      "https://foo.internal/x",
      "https://printer.local/x",
      "https://intranet/x",
    ]) assert.equal(await code(u), "blocked_host", u);
  });
  await run("unresolvable name = dns_failed", async () => {
    assert.equal(await code("https://nope.example.com/x"), "dns_failed");
    assert.equal(await code("https://agent.example.com/x", async () => []), "dns_failed");
  });
  await run("DNS that hangs = dns_failed within the budget", async () => {
    const r = await checkAgentUrl("https://agent.example.com/x", { resolver: () => new Promise(() => {}), dnsTimeoutMs: 20 });
    assert.deepEqual(r, { ok: false, code: "dns_failed" });
  });

  // ── Scheme, userinfo, port ──────────────────────────────────────────
  await run("https only", async () => {
    assert.equal(await code("http://agent.example.com/x"), "not_https");
    assert.equal(await code("ftp://agent.example.com/x"), "not_https");
    assert.equal(await code("file:///etc/passwd"), "not_https");
    assert.equal(await code("not a url"), "invalid_url");
    assert.equal(await code(""), "invalid_url");
  });
  await run("no userinfo", async () => {
    assert.equal(await code("https://user:pw@agent.example.com/x"), "userinfo");
    assert.equal(await code("https://user@agent.example.com/x"), "userinfo");
  });
  await run("port 443 / 8443 only", async () => {
    assert.equal(await code("https://agent.example.com:443/x"), "ok");
    assert.equal(await code("https://agent.example.com:8443/x"), "ok");
    for (const p of [22, 80, 5432, 6379, 8080, 9000]) assert.equal(await code(`https://agent.example.com:${p}/x`), "port", String(p));
  });
  await run("the user message is one plain sentence", () => {
    assert.equal(SAFE_URL_MESSAGE, "This address can't be used");
    assert.equal(new SafeUrlError("blocked_address").message, "blocked_address");
  });

  // ── safeFetch (injected transport) ──────────────────────────────────
  const transportOf = (status: number, chunks: string[], opts: { delayMs?: number; useLookup?: boolean } = {}): Transport =>
    async ({ url, lookup, signal }) => {
      if (opts.useLookup !== false) {
        await new Promise<void>((resolve, reject) =>
          lookup(url.hostname, { all: true }, (err) => (err ? reject(err) : resolve())),
        );
      }
      if (opts.delayMs) await new Promise((r, j) => { const t = setTimeout(r, opts.delayMs); signal.addEventListener("abort", () => { clearTimeout(t); j(new Error("aborted")); }); });
      return { status, headers: {}, body: Readable.from(chunks.map((c) => Buffer.from(c))) };
    };
  const failCode = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      assert.ok(e instanceof SafeUrlError, String(e));
      return (e as SafeUrlError).code;
    }
  };
  const base = { timeoutMs: 500, maxBytes: 1000, resolver: publicResolver };

  await run("safeFetch returns status and body", async () => {
    const r = await safeFetch("https://agent.example.com/x", { method: "POST", body: "{}" }, { ...base, transport: transportOf(200, ['{"answer":', '"hi"}']) });
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), '{"answer":"hi"}');
  });
  await run("safeFetch refuses a blocked url before any connection", async () => {
    let called = false;
    const t: Transport = async () => { called = true; throw new Error("x"); };
    assert.equal(await failCode(safeFetch("https://10.0.0.1/x", {}, { ...base, transport: t })), "blocked_address");
    assert.equal(await failCode(safeFetch("http://agent.example.com/x", {}, { ...base, transport: t })), "not_https");
    assert.equal(called, false);
  });
  await run("safeFetch refuses redirects", async () => {
    for (const s of [301, 302, 307, 308]) assert.equal(await failCode(safeFetch("https://agent.example.com/x", {}, { ...base, transport: transportOf(s, []) })), "redirect");
  });
  await run("safeFetch times out", async () => {
    const t0 = Date.now();
    assert.equal(await failCode(safeFetch("https://agent.example.com/x", {}, { ...base, timeoutMs: 30, transport: transportOf(200, ["x"], { delayMs: 5000 }) })), "timeout");
    assert.ok(Date.now() - t0 < 1000);
  });
  await run("safeFetch caps the response size", async () => {
    const chunks = Array(20).fill("x".repeat(100));
    assert.equal(await failCode(safeFetch("https://agent.example.com/x", {}, { ...base, transport: transportOf(200, chunks) })), "too_large");
    const ok = await safeFetch("https://agent.example.com/x", {}, { ...base, transport: transportOf(200, Array(10).fill("x".repeat(100))) });
    assert.equal(ok.body.length, 1000);
  });
  await run("safeFetch maps a transport failure to network", async () => {
    const t: Transport = async () => { throw new Error("ECONNRESET 1.2.3.4"); };
    assert.equal(await failCode(safeFetch("https://agent.example.com/x", {}, { ...base, transport: t })), "network");
  });
  await run("DNS rebinding: public at check, private at connect = refused", async () => {
    let n = 0;
    const rebinding: Resolver = async () => [v(n++ === 0 ? PUBLIC4 : "169.254.169.254")];
    assert.equal(await failCode(safeFetch("https://agent.example.com/x", {}, { ...base, resolver: rebinding, transport: transportOf(200, ["x"]) })), "blocked_address");
    assert.equal(n, 2, "resolved twice: at check and at connect");
  });
  await run("connect-time lookup returns only checked addresses, single or all", async () => {
    const lookup = guardedLookup(publicResolver);
    const single = await new Promise<[string, number]>((res, rej) =>
      lookup("agent.example.com", {}, ((e: Error | null, a: string, f: number) => (e ? rej(e) : res([a, f]))) as never),
    );
    assert.deepEqual(single, [PUBLIC4, 4]);
    const all = await new Promise<ResolvedAddress[]>((res, rej) =>
      lookup("agent.example.com", { all: true }, ((e: Error | null, a: ResolvedAddress[]) => (e ? rej(e) : res(a))) as never),
    );
    assert.equal(all.length, 2);
    const err = await new Promise<unknown>((res) => lookup("[::1]", {}, ((e: unknown) => res(e)) as never));
    assert.ok(err instanceof SafeUrlError && err.code === "blocked_address");
  });

  // ── Legacy agent webhook: save decision (3 cases + admin) ───────────
  const check = { resolver: publicResolver };
  const SAFE = "https://agent.example.com/hook";
  await run("save: other fields pass for a tenant (enabled toggle, secret) with the SAME url", async () => {
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: SAFE, url: SAFE, wantsEnabled: false, isAdmin: false, check }), { ok: true });
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: SAFE, url: SAFE, wantsEnabled: true, isAdmin: false, check }), { ok: true });
  });
  await run("save: an unchanged re-send passes for a tenant (no url either)", async () => {
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: "", url: "", wantsEnabled: false, isAdmin: false, check }), { ok: true });
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: ` ${SAFE}`, url: SAFE, wantsEnabled: false, isAdmin: false, check }), { ok: true });
  });
  await run("save: a changed url from a tenant = 403 admin_only", async () => {
    const want = { ok: false, status: 403, body: { error: "admin_only", fields: ["url"] } };
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: "", url: SAFE, wantsEnabled: false, isAdmin: false, check }), want);
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: SAFE, url: "https://agent.example.com/other", wantsEnabled: true, isAdmin: false, check }), want);
  });
  await run("save: an admin can change the url, to a safe one only", async () => {
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: "", url: SAFE, wantsEnabled: true, isAdmin: true, check }), { ok: true });
    const unsafe = { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE } };
    for (const u of ["http://agent.example.com/hook", "https://10.0.0.1/hook", "https://169.254.169.254/latest", "https://localhost/hook"]) {
      assert.deepEqual(await agentBrainSaveDecision({ currentUrl: "", url: u, wantsEnabled: false, isAdmin: true, check }), unsafe, u);
    }
  });
  await run("save: turning on an unsafe stored url is refused, turning it off passes", async () => {
    const legacy = "http://10.0.0.1/hook";
    assert.equal((await agentBrainSaveDecision({ currentUrl: legacy, url: legacy, wantsEnabled: true, isAdmin: false, check })).ok, false);
    assert.deepEqual(await agentBrainSaveDecision({ currentUrl: legacy, url: legacy, wantsEnabled: false, isAdmin: false, check }), { ok: true });
    assert.equal((await agentBrainSaveDecision({ currentUrl: "", url: "", wantsEnabled: true, isAdmin: true, check })).ok, false, "enable without url");
  });

  // ── Legacy agent webhook: serve decision ────────────────────────────
  await run("serve: a safe webhook is served unchanged (same object)", async () => {
    const w = { url: SAFE, secret: "mock-secret" };
    const r = await servedAgentWebhook(w, check);
    assert.equal(r.webhook, w);
    assert.equal(r.refused, null);
    assert.deepEqual(await servedAgentWebhook(undefined, check), { webhook: undefined, refused: null });
  });
  await run("serve: unsafe webhooks are omitted (http, private, metadata, localhost)", async () => {
    for (const [u, c] of [
      ["http://agent.example.com/hook", "not_https"],
      ["https://192.168.1.10/hook", "blocked_address"],
      ["https://169.254.169.254/latest/meta-data", "blocked_address"],
      ["https://localhost/hook", "blocked_host"],
    ]) assert.deepEqual(await servedAgentWebhook({ url: u }, check), { webhook: undefined, refused: c }, u);
  });

  console.log("safe-url: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// The url saved and the response a viewer gets (the screen can't see the url).
{
  const SAFE_URL = "https://agent.example.com/hook";
  // tenant: absent or "" keeps the stored url; a real different one stays a change (→ 403 above)
  assert.equal(urlToSave(undefined, SAFE_URL, false), SAFE_URL);
  assert.equal(urlToSave("", SAFE_URL, false), SAFE_URL);
  assert.equal(urlToSave("  ", SAFE_URL, false), SAFE_URL);
  assert.equal(urlToSave("https://other.example.com/x", SAFE_URL, false), "https://other.example.com/x");
  // admin: absent keeps, "" clears
  assert.equal(urlToSave(undefined, SAFE_URL, true), SAFE_URL);
  assert.equal(urlToSave("", SAFE_URL, true), "");
  // never the secret's value (nor the url) to a tenant
  const stored = { enabled: true, url: SAFE_URL, secret: "mock-secret-value-123" };
  const tenant = brainView(stored, false);
  assert.deepEqual(tenant, { enabled: true, url: "", urlSet: true, secretSet: true });
  assert.ok(!JSON.stringify(tenant).includes("mock-secret") && !JSON.stringify(tenant).includes("agent.example.com"));
  assert.deepEqual(brainView(stored, true), { enabled: true, url: SAFE_URL, urlSet: true, secretSet: true, secret: "mock-secret-value-123" });
  assert.deepEqual(brainView({ enabled: false, url: "" }, false), { enabled: false, url: "", urlSet: false, secretSet: false });
  console.log("ok   agent-brain: urlToSave + brainView");
}
