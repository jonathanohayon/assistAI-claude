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

/** Client IP behind Railway's proxy: first X-Forwarded-For entry. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
