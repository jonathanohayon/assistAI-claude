import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Lazy: defer the connection until the first DB call. This lets `next build`
// type-check / collect routes without DATABASE_URL set, and lets the app
// boot in environments where the DB hasn't been provisioned yet — only
// failing at the actual query site with a clear message.

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let cached: DrizzleDb | null = null;

const initDb = (): DrizzleDb => {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add the Postgres plugin on Railway and expose DATABASE_URL on the web service.",
    );
  }
  const client = postgres(connectionString, { max: 5, prepare: false });
  cached = drizzle(client, { schema });
  return cached;
};

// Proxy the eventual `drizzle()` instance so `db.select(...)` triggers init
// on first use — but `import { db }` itself is a no-op at build time.
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = initDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
