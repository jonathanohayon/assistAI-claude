// The public pages (no sign-in) every public scan covers, in fr/en/he ("" =
// the home): scripts/check-public-bundle.mjs, scripts/check-tenant-words.mjs
// and the gate's public-pages-check.mjs (which reads this file when the
// worktree has it). One list, so a new public page is scanned everywhere.
export const PUBLIC_PATHS = ["", "/login", "/signup", "/verify-email", "/forgot-password", "/sales", "/connect", "/agent-address-help"];
