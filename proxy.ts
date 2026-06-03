import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// Locale-prefixed marketing routes handled by next-intl. Everything else
// (dashboard, login, admin, api, …) is not locale-prefixed.
const MARKETING = /^\/(?:$|(?:fr|he|en)(?:\/|$))/;

// Security headers applied to every response.
// HSTS without `preload` on purpose — preload is hard to reverse.
function applySecurityHeaders(response: NextResponse) {
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains",
  );
  response.headers.set("Content-Security-Policy", "upgrade-insecure-requests");
  return response;
}

export default function middleware(request: NextRequest) {
  if (MARKETING.test(request.nextUrl.pathname)) {
    const response = intlMiddleware(request);
    // Railway proxies :443 (public) → :8080 (internal). next-intl builds
    // redirects from request.nextUrl which includes the internal port → the
    // browser hits https://host:8080 and gets ECONNREFUSED. Strip the port so
    // Location uses the protocol default (443 for https).
    const location = response.headers.get("location");
    if (location) {
      try {
        const url = new URL(location);
        if (url.port) {
          url.port = "";
          response.headers.set("location", url.toString());
        }
      } catch {
        /* keep original Location if it isn't a valid URL */
      }
    }
    return applySecurityHeaders(response);
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  // Run on every route except Next internals and static assets, so the
  // security headers cover the whole app (not just marketing pages).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
