import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// Wrap next-intl's middleware to strip the internal port from redirect URLs.
// Railway proxies traffic from :443 (public) to :8080 (internal). next-intl
// builds redirects from `request.nextUrl` which includes the internal port
// → the browser tries https://host:8080 and gets ECONNREFUSED. We rewrite
// the Location header to use the public host's default port.
export default function middleware(request: NextRequest) {
  const response = intlMiddleware(request);
  const location = response.headers.get("location");
  if (location) {
    try {
      const url = new URL(location);
      // Drop the port → Location uses the protocol's default (443 for https).
      // Public Railway URLs always live on the standard HTTPS port.
      if (url.port) {
        url.port = "";
        response.headers.set("location", url.toString());
      }
    } catch {
      /* keep original Location if it isn't a valid URL */
    }
  }
  return response;
}

export const config = {
  // Only intercept marketing routes — dashboard, login, signup, onboarding,
  // admin, api, and Next internals are NOT locale-prefixed.
  matcher: ["/", "/(fr|he|en)/:path*"],
};
