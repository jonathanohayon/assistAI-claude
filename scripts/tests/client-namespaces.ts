// Static walker: which next-intl namespaces can a route's CLIENT components
// read? Follows imports (relative + "@/") from the given entry files and
// collects `useTranslations("Ns…")` in every "use client" module reached
// (a client module's own imports are client too).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const EXTS = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // package import
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && /\.(tsx?|jsx?)$/.test(p)) return p;
  }
  return null;
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const NS_RE = /useTranslations\(\s*(?:["'`]([A-Za-z0-9_]+)[."'`]|([^)\s]*))/g;

export type WalkResult = { namespaces: Set<string>; unknown: string[]; clientFiles: Set<string> };

export function clientNamespaces(entries: string[]): WalkResult {
  const namespaces = new Set<string>();
  const unknown: string[] = [];
  const clientFiles = new Set<string>();
  const seen = new Map<string, boolean>(); // file -> visited as client?
  const stack: Array<[string, boolean]> = entries.map((e) => [resolve(ROOT, e), false]);
  while (stack.length) {
    const [file, parentIsClient] = stack.pop()!;
    const src = readFileSync(file, "utf8");
    const isClient = parentIsClient || /^\s*["']use client["']/.test(src);
    const prev = seen.get(file);
    if (prev === true || (prev === false && !isClient)) continue;
    seen.set(file, isClient);
    if (isClient) {
      clientFiles.add(file);
      for (const m of src.matchAll(NS_RE)) {
        if (m[1]) namespaces.add(m[1]);
        else unknown.push(`${file.replace(ROOT + "/", "")}: useTranslations(${m[2] || ""})`);
      }
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1] ?? m[2]);
      if (target && !/\/lib\/db\//.test(target)) stack.push([target, isClient]);
    }
  }
  return { namespaces, unknown, clientFiles };
}

if (process.argv[1]?.endsWith("client-namespaces.ts")) {
  const r = clientNamespaces(process.argv.slice(2));
  console.log([...r.namespaces].sort().join("\n"));
  if (r.unknown.length) console.error("UNKNOWN:\n" + r.unknown.join("\n"));
  console.error(`${r.clientFiles.size} client files`);
}
