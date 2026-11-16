// Stands in for lib/db/index.ts under scripts/tests/lib/admin-route-harness.ts.
// Any Drizzle chain resolves to ONE sentinel row of its table (see the harness).
import { is, Table } from "drizzle-orm";

import { projectRow } from "./admin-route-harness";

type Kind = "select" | "insert" | "update" | "delete";

interface ChainState {
  kind: Kind;
  table: Table | null;
  fields?: Record<string, unknown>;
  returning?: Record<string, unknown> | true;
  set?: Record<string, unknown>;
}

function result(s: ChainState): unknown[] {
  if (s.kind === "select") return [projectRow(s.table, s.fields)];
  if (!s.returning) return [];
  const extra = s.kind === "delete" ? {} : (s.set ?? {});
  return [projectRow(s.table, s.returning === true ? undefined : s.returning, extra)];
}

function chain(s: ChainState): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result(s)).then(ok, ko);
      }
      if (prop === "catch" || prop === "finally") {
        return (...a: unknown[]) => (Promise.resolve(result(s)) as unknown as Record<string, (...x: unknown[]) => unknown>)[prop as string](...a);
      }
      if (typeof prop === "symbol") return undefined;
      return (...args: unknown[]) => {
        if (prop === "from" && is(args[0], Table)) s.table = args[0] as Table;
        if (prop === "returning") s.returning = (args[0] as Record<string, unknown> | undefined) ?? true;
        if (prop === "set" || prop === "values") s.set = (Array.isArray(args[0]) ? args[0][0] : args[0]) as Record<string, unknown>;
        return proxy;
      };
    },
  });
  return proxy;
}

const start = (kind: Kind) => (arg?: unknown) =>
  is(arg, Table)
    ? chain({ kind, table: arg as Table })
    : chain({ kind, table: null, fields: arg as Record<string, unknown> | undefined });

export const db: Record<string, unknown> = {
  select: start("select"),
  selectDistinct: start("select"),
  insert: start("insert"),
  update: start("update"),
  delete: start("delete"),
  execute: async () => Object.assign([], { rows: [] }),
  transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  query: new Proxy(
    {},
    {
      get: () => ({ findFirst: async () => null, findMany: async () => [] }),
    },
  ),
};
