// Outbound URL guard (SSRF) — SERVER-ONLY. ONE module for every URL a
// customer gives us to call (their agent's webhook, the "ask your agent"
// tool). The worker mirrors it.
//
//   checkAgentUrl(url)  — https only, no userinfo, port 443/8443, no internal
//     hostname, and EVERY address the name resolves to must be public.
//   safeFetch(url, …)   — re-checks at CONNECT time (the socket connects to
//     the address we resolved and checked, so DNS rebinding between check and
//     connect can't reach our network), no redirects, a timeout and a
//     response size cap.
//
// Errors are stable codes only. The user sees ONE plain message
// (SAFE_URL_MESSAGE): never the resolved address nor which rule tripped —
// that detail would map our network for whoever probes it.

import dns from "node:dns";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

export const SAFE_URL_MESSAGE = "This address can't be used";

/**
 * 443 = HTTPS. 8443 = the usual alternate HTTPS port (staging / self-hosted
 * agent servers behind a TLS-terminating proxy). Every other port is refused:
 * it would let a URL knock on non-web services (SSH, databases, Redis…).
 */
export const ALLOWED_PORTS: readonly number[] = [443, 8443];

export type UnsafeUrlCode =
  | "invalid_url"
  | "not_https"
  | "userinfo"
  | "port"
  | "blocked_host"
  | "blocked_address"
  | "dns_failed";

export type FetchFailCode = UnsafeUrlCode | "redirect" | "timeout" | "too_large" | "network";

export class SafeUrlError extends Error {
  constructor(readonly code: FetchFailCode) {
    // The message is the code: never an address or a host.
    super(code);
    this.name = "SafeUrlError";
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
/** Resolves a hostname to ALL its addresses (A + AAAA). Injected in tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

// Through the `dns` namespace (not a destructured import) so a proof script
// can stub it; tests inject `resolver` instead.
export const systemResolver: Resolver = async (hostname) => {
  const all = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

// ── Address classification ──────────────────────────────────────────────

function v4ToInt(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const s of p) {
    if (!/^\d{1,3}$/.test(s)) return null;
    const v = Number(s);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const cidr4 = (base: string, bits: number): [number, number] => [v4ToInt(base)!, bits];
const BLOCKED_V4: Array<[number, number]> = [
  cidr4("0.0.0.0", 8), // unspecified / "this network"
  cidr4("10.0.0.0", 8), // private
  cidr4("100.64.0.0", 10), // CGNAT
  cidr4("127.0.0.0", 8), // loopback
  cidr4("169.254.0.0", 16), // link-local, cloud metadata 169.254.169.254
  cidr4("172.16.0.0", 12), // private
  cidr4("192.0.0.0", 24), // IETF protocol assignments
  cidr4("192.0.2.0", 24), // documentation
  cidr4("192.168.0.0", 16), // private
  cidr4("198.18.0.0", 15), // benchmarking
  cidr4("198.51.100.0", 24), // documentation
  cidr4("203.0.113.0", 24), // documentation
  cidr4("224.0.0.0", 4), // multicast
  cidr4("240.0.0.0", 4), // reserved, broadcast 255.255.255.255
];

function v4Blocked(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return n >= base && n < base + size;
  });
}

/** IPv6 text → 128-bit BigInt (null when it isn't one). */
function v6ToBig(ip: string): bigint | null {
  let s = ip.toLowerCase();
  if (s.includes("%")) return null; // zone ids never appear in a URL host
  // A dotted IPv4 tail (::ffff:1.2.3.4) → two hex groups.
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = v4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill("0"), ...rest];
  } else groups = head;
  if (groups.length !== 8) return null;
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

const big = (hex: string) => BigInt(`0x${hex}`);
const inV6 = (n: bigint, prefix: bigint, bits: number) => n >> BigInt(128 - bits) === prefix >> BigInt(128 - bits);
const P = (groups: string) => {
  const n = v6ToBig(groups);
  if (n === null) throw new Error("bad prefix");
  return n;
};
const V6_BLOCKED: Array<[bigint, number]> = [
  [P("fc00::"), 7], // unique local (fd00:ec2::254 = AWS metadata over IPv6)
  [P("fe80::"), 10], // link-local
  [P("fec0::"), 10], // site-local (deprecated)
  [P("ff00::"), 8], // multicast
  [P("2001:db8::"), 32], // documentation
  [P("2001::"), 32], // Teredo
  [P("100::"), 64], // discard-only
];
// Prefixes that embed an IPv4 address: the embedded one decides.
const V6_EMBEDS_V4: Array<[bigint, number]> = [
  [P("::ffff:0:0"), 96], // IPv4-mapped
  [P("::"), 96], // IPv4-compatible (deprecated), also :: and ::1 below
  [P("64:ff9b::"), 96], // NAT64
];

/** True when `ip` (an IP literal) is not a public unicast address. */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = v4ToInt(ip);
    return n === null || v4Blocked(n);
  }
  if (fam !== 6) return true;
  const n = v6ToBig(ip);
  if (n === null) return true;
  if (n === BigInt(0) || n === BigInt(1)) return true; // :: unspecified, ::1 loopback
  for (const [p, bits] of V6_EMBEDS_V4) if (inV6(n, p, bits)) return v4Blocked(Number(n & big("ffffffff")));
  // 6to4 2002:V4ADDR::/48 — the embedded IPv4 decides.
  if (inV6(n, P("2002::"), 16)) return v4Blocked(Number((n >> BigInt(80)) & big("ffffffff")));
  return V6_BLOCKED.some(([p, bits]) => inV6(n, p, bits));
}

// ── Hostnames ───────────────────────────────────────────────────────────

const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".localdomain", ".home.arpa", ".lan"];

function hostnameBlocked(host: string): boolean {
  if (host === "localhost" || host === "localhost.localdomain") return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true; // *.railway.internal, metadata.google.internal
  // A single-label name resolves through the server's search domains.
  return !host.includes(".");
}

// ── checkAgentUrl ───────────────────────────────────────────────────────

export type CheckResult =
  | { ok: true; url: URL; hostname: string; addresses: ResolvedAddress[] }
  | { ok: false; code: UnsafeUrlCode };

export interface CheckOptions {
  resolver?: Resolver;
  /** DNS budget: a name that doesn't resolve in time is refused. */
  dnsTimeoutMs?: number;
}

/** Static part: everything decidable without DNS. */
export function checkAgentUrlShape(
  raw: unknown,
): { ok: true; url: URL; hostname: string; literal: boolean } | { ok: false; code: UnsafeUrlCode } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, code: "invalid_url" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  if (url.username || url.password) return { ok: false, code: "userinfo" };
  const port = url.port ? Number(url.port) : 443;
  if (!ALLOWED_PORTS.includes(port)) return { ok: false, code: "port" };
  // WHATWG URL already canonicalised IPv4 forms (0x7f.1, 2130706433 → 127.0.0.1).
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return { ok: false, code: "invalid_url" };
  if (isIP(host)) return isBlockedAddress(host) ? { ok: false, code: "blocked_address" } : { ok: true, url, hostname: host, literal: true };
  if (hostnameBlocked(host)) return { ok: false, code: "blocked_host" };
  return { ok: true, url, hostname: host, literal: false };
}

async function resolveChecked(
  hostname: string,
  resolver: Resolver,
  dnsTimeoutMs: number,
): Promise<{ ok: true; addresses: ResolvedAddress[] } | { ok: false; code: UnsafeUrlCode }> {
  let addresses: ResolvedAddress[];
  let timer: NodeJS.Timeout | undefined;
  try {
    addresses = await Promise.race([
      resolver(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("dns timeout")), dnsTimeoutMs);
      }),
    ]);
  } catch {
    return { ok: false, code: "dns_failed" };
  } finally {
    clearTimeout(timer);
  }
  if (!addresses.length) return { ok: false, code: "dns_failed" };
  // ALL records must be public: one private record is enough to refuse.
  if (addresses.some((a) => isBlockedAddress(a.address))) return { ok: false, code: "blocked_address" };
  return { ok: true, addresses };
}

export async function checkAgentUrl(raw: unknown, opts: CheckOptions = {}): Promise<CheckResult> {
  const shape = checkAgentUrlShape(raw);
  if (!shape.ok) return shape;
  if (shape.literal) {
    return { ok: true, url: shape.url, hostname: shape.hostname, addresses: [{ address: shape.hostname, family: isIP(shape.hostname) === 6 ? 6 : 4 }] };
  }
  const r = await resolveChecked(shape.hostname, opts.resolver ?? systemResolver, opts.dnsTimeoutMs ?? 2000);
  if (!r.ok) return r;
  return { ok: true, url: shape.url, hostname: shape.hostname, addresses: r.addresses };
}

// ── safeFetch ───────────────────────────────────────────────────────────

export interface SafeFetchInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  resolver?: Resolver;
  /** Tests only: replaces the HTTPS request (no real network in tests). */
  transport?: Transport;
}

export interface SafeResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** What a transport gets back: status, headers, a byte stream. */
export interface TransportResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Buffer | Uint8Array>;
}
export type Transport = (args: {
  url: URL;
  init: SafeFetchInit;
  /** The connect-time lookup: resolves AGAIN and refuses a blocked address. */
  lookup: LookupFunction;
  signal: AbortSignal;
}) => Promise<TransportResponse>;

/**
 * A `net` lookup that resolves through `resolver` and refuses (SafeUrlError
 * blocked_address) when any address is blocked — the socket can only connect
 * to an address that passed the check at THAT moment. TLS SNI and the Host
 * header stay the hostname.
 */
export function guardedLookup(resolver: Resolver): LookupFunction {
  return ((hostname: string, options: { all?: boolean } | number | undefined, callback: (...a: unknown[]) => void) => {
    const all = typeof options === "object" && options?.all === true;
    const host = hostname.replace(/^\[|\]$/g, "");
    const done = (addresses: ResolvedAddress[]) =>
      all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
    if (isIP(host)) {
      if (isBlockedAddress(host)) return callback(new SafeUrlError("blocked_address"));
      return done([{ address: host, family: isIP(host) === 6 ? 6 : 4 }]);
    }
    resolveChecked(host.toLowerCase(), resolver, 2000).then(
      (r) => (r.ok ? done(r.addresses) : callback(new SafeUrlError(r.code))),
      () => callback(new SafeUrlError("dns_failed")),
    );
  }) as LookupFunction;
}

const httpsTransport: Transport = ({ url, init, lookup, signal }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        lookup,
        signal,
        // No proxy, no keep-alive pool shared with other code.
        agent: false,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    // Belt and braces: the peer we actually reached must be public too.
    req.on("socket", (sock) => {
      sock.once("connect", () => {
        if (sock.remoteAddress && isBlockedAddress(sock.remoteAddress)) req.destroy(new SafeUrlError("blocked_address"));
      });
    });
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });

/**
 * Fetches a customer URL safely. Throws SafeUrlError with a stable code:
 * any UnsafeUrlCode, "redirect" (any 3xx — redirects are never followed),
 * "timeout", "too_large" (stops reading past maxBytes), "network".
 */
export async function safeFetch(raw: string, init: SafeFetchInit, opts: SafeFetchOptions): Promise<SafeResponse> {
  const resolver = opts.resolver ?? systemResolver;
  const checked = await checkAgentUrl(raw, { resolver });
  if (!checked.ok) throw new SafeUrlError(checked.code);

  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, opts.timeoutMs);
  const fail = (e: unknown): never => {
    if (timedOut) throw new SafeUrlError("timeout");
    if (e instanceof SafeUrlError) throw e;
    // Node wraps lookup errors; keep our code when it is one.
    const cause = (e as { cause?: unknown })?.cause;
    if (cause instanceof SafeUrlError) throw cause;
    throw new SafeUrlError("network");
  };
  try {
    const transport = opts.transport ?? httpsTransport;
    const abort = new Promise<never>((_, reject) => ac.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const res = await Promise.race([transport({ url: checked.url, init, lookup: guardedLookup(resolver), signal: ac.signal }), abort]).catch(fail);
    if (res.status >= 300 && res.status < 400) throw new SafeUrlError("redirect");
    const chunks: Buffer[] = [];
    let size = 0;
    const read = (async () => {
      for await (const c of res.body) {
        size += c.length;
        if (size > opts.maxBytes) throw new SafeUrlError("too_large");
        chunks.push(Buffer.from(c));
      }
    })();
    await Promise.race([read, abort]).catch(fail);
    return { status: res.status, headers: res.headers, body: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}
