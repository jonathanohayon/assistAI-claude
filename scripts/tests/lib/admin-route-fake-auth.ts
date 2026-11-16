// Stands in for auth.ts under scripts/tests/lib/admin-route-harness.ts:
// the session is the mock admin.
import { ADMIN_ID } from "./admin-route-harness";

export const auth = async () => ({ user: { id: ADMIN_ID, email: "admin@example.com" }, expires: "2099-01-01T00:00:00.000Z" });
export const signIn = async () => undefined;
export const signOut = async () => undefined;
const refuse = async () => new Response(null, { status: 404 });
export const handlers = { GET: refuse, POST: refuse };
