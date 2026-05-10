import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Only intercept marketing routes — dashboard, login, signup, onboarding,
  // admin, api, and Next internals are NOT locale-prefixed.
  matcher: [
    "/",
    "/(fr|he|en)/:path*",
  ],
};
