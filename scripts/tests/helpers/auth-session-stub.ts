// Test-only stand-in for "@/auth" (next-auth), so a DB suite can call a route
// handler under tsx as a given user. The test sets the signed-in user id with
// setTestSession(); auth() returns { user: { id } } or null, the only shape the
// guards in lib/api/auth-guards.ts read. Mapped in by a test tsconfig written
// by scripts/events-route-mask-db.sh, never imported by the app.

let current: string | null = null;

export function setTestSession(userId: string | null): void {
  current = userId;
}

export async function auth(): Promise<{ user: { id: string } } | null> {
  return current ? { user: { id: current } } : null;
}
