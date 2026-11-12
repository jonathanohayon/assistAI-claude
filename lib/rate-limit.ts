// Fixed-window, in-memory rate limiter. Per process: Railway runs a single
// web instance today, so this bounds abuse without a Redis. With several
// instances the effective limit multiplies by their count. Acceptable for
// a cost guard, not for anything security-critical.

export interface RateLimiter {
  /** true if this hit is allowed; false once the key is over its limit. */
  hit(key: string, now?: number): boolean;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  /** Cap on tracked keys so a flood of distinct IPs can't grow memory forever. */
  maxKeys?: number;
}): RateLimiter {
  const maxKeys = opts.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(key, now = Date.now()) {
      const w = windows.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        if (!w && windows.size >= maxKeys) {
          // Drop expired windows first; if still full, refuse (fail closed).
          for (const [k, v] of windows) {
            if (now - v.start >= opts.windowMs) windows.delete(k);
          }
          if (windows.size >= maxKeys) return false;
        }
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      w.count += 1;
      return w.count <= opts.limit;
    },
  };
}

/**
 * Client IP behind Railway's HTTP edge — BEST-EFFORT, not a guarantee.
 *
 * Order: X-Real-IP, else the first X-Forwarded-For entry, else "unknown".
 * Per Railway staff (forum answers, not a versioned contract), the public
 * edge OVERWRITES caller-supplied X-Real-IP and X-Forwarded-For, and X-Real-IP
 * is the header they recommend for rate limiting. Known caveats: X-Real-IP
 * has been reported to carry a CDN edge IP when Railway's CDN is in the path,
 * and *.railway.internal traffic skips the edge (headers are then caller
 * controlled). So every per-IP limit built on this MUST keep a global ceiling
 * as its backstop. Sources:
 *   https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86
 *   https://station.railway.com/questions/which-header-should-i-rely-on-for-real-c-d78a6f96
 *   https://station.railway.com/questions/edge-cdn-layer-leaking-its-own-ip-as-cli-1ce29b05
 * Used by the signup per-IP cap and the anonymous /api/session limiter.
 */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}
