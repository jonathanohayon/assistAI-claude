// Test double for @/auth: the session is whatever the test put in
// globalThis.__demoSheetSession (null = signed out, the anonymous home demo).
type MockSession = { user: { id: string; email?: string } } | null;
const g = globalThis as { __demoSheetSession?: MockSession };
export async function auth(): Promise<MockSession> {
  return g.__demoSheetSession ?? null;
}
export const handlers = {};
export async function signIn(): Promise<never> {
  throw new Error("signIn is not available in tests");
}
export async function signOut(): Promise<never> {
  throw new Error("signOut is not available in tests");
}
