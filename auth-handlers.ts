// Thin re-export for the Next.js route handler. Keeping this in a separate
// file lets `auth.ts` be imported from middleware (Edge runtime) without
// pulling in the request-handler bundle.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
