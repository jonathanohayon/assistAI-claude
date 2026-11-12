// Test discovery shared by the two runners and their guard test.
// Pure functions over the file system: no process is started here.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every scripts/tests/**\/*.test.ts, repo-relative, sorted. */
export function discoverUnitTests(root = ROOT) {
  const dir = path.join(root, "scripts", "tests");
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".test.ts"))
    .map((e) => path.relative(root, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join("/"))
    .sort();
}

/** Every scripts/*-db.sh as { name, file }, sorted by name. name = file name without "-db.sh". */
export function discoverDbSuites(root = ROOT) {
  return readdirSync(path.join(root, "scripts"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith("-db.sh"))
    .map((e) => ({ name: e.name.slice(0, -"-db.sh".length), file: `scripts/${e.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
