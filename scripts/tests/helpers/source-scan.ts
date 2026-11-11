// Source scans for guard tests ("nothing else imports X", "no file contains Y").
//
// A guard that walks the tree and asserts "the offenders are exactly [...]" or
// "no file matches" passes just as happily when the walk read NOTHING (wrong
// cwd, renamed directory, an extension filter that never matches, an exclusion
// that swallows a whole root). scanSources() reads every file it lists, and
// assertScanRead() proves the scan saw the real tree before the guard trusts it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, resolved from this file's location: independent of the cwd. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export type ScanOptions = {
  /** File names to keep (tested on the base name). */
  ext: RegExp;
  /** Directories to skip, as repo-relative paths (e.g. "scripts/tests"). node_modules is always skipped. */
  skipDirs?: string[];
  /** Base directory the roots are relative to (default REPO_ROOT). Tests only. */
  base?: string;
};

export type Scan = {
  /** Repo-relative paths with "/" separators, sorted. */
  files: string[];
  /** Number of files found under each root (a root may be a single file). */
  perRoot: Record<string, number>;
  /** The content read for each listed file. */
  text: Map<string, string>;
};

const toPosix = (p: string) => p.split(sep).join("/");

/** Walks each root (a directory or a single file) and reads every kept file. */
export function scanSources(roots: string[], opts: ScanOptions): Scan {
  const base = opts.base ?? REPO_ROOT;
  const skip = new Set(opts.skipDirs ?? []);
  const text = new Map<string, string>();
  const perRoot: Record<string, number> = {};
  const walk = (rel: string): string[] => {
    const abs = join(base, rel);
    if (!statSync(abs).isDirectory()) return [toPosix(rel)];
    return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
      const child = toPosix(join(rel, e.name));
      if (e.isDirectory()) return e.name === "node_modules" || skip.has(child) ? [] : walk(child);
      return opts.ext.test(e.name) ? [child] : [];
    });
  };
  for (const root of roots) {
    const found = walk(root);
    perRoot[root] = found.length;
    for (const f of found) text.set(f, readFileSync(join(base, f), "utf8"));
  }
  return { files: [...text.keys()].sort(), perRoot, text };
}

export type ScanExpectations = {
  /** Minimum total number of files. */
  minFiles: number;
  /** Minimum number of files under each DIRECTORY root (single-file roots must be found). */
  minPerRoot?: number;
  /** Files that must have been listed AND read with non-empty content. */
  sentinels: string[];
  /** Path prefixes that must NOT appear (the exclusions really excluded them). */
  absent?: string[];
};

/** Fails unless the scan demonstrably read the real tree. */
export function assertScanRead(scan: Scan, label: string, x: ScanExpectations): void {
  assert.ok(scan.files.length >= x.minFiles, `${label}: scan read ${scan.files.length} files, expected >= ${x.minFiles} (wrong root or filter?)`);
  for (const [root, n] of Object.entries(scan.perRoot)) {
    const isFile = /\.[a-z]+$/.test(root);
    const min = isFile ? 1 : (x.minPerRoot ?? 1);
    assert.ok(n >= min, `${label}: root "${root}" yielded ${n} files, expected >= ${min}`);
  }
  for (const s of x.sentinels) {
    assert.ok(scan.text.has(s), `${label}: sentinel ${s} was not scanned`);
    assert.ok((scan.text.get(s) ?? "").trim().length > 0, `${label}: sentinel ${s} was read empty`);
  }
  for (const prefix of x.absent ?? []) {
    const leaked = scan.files.filter((f) => f === prefix || f.startsWith(`${prefix}/`));
    assert.deepEqual(leaked, [], `${label}: ${prefix} should be excluded from the scan`);
  }
}
