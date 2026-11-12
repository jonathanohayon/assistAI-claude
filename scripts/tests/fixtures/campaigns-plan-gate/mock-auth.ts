// Test double for @/auth: the session is whatever the test put in
// globalThis.__campgateSession (null = signed out).
type MockSession = { user: { id: string; email?: string } } | null;
const g = globalThis as { __campgateSession?: MockSession };
export async function auth(): Promise<MockSession> {
  return g.__campgateSession ?? null;
}
export const handlers = {};
export async function signIn(): Promise<never> {
  throw new Error("signIn is not available in tests");
}
export async function signOut(): Promise<never> {
  throw new Error("signOut is not available in tests");
}
