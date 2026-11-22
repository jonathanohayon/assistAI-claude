// Leaf diff of two config-bytes snapshots (scripts/config-bytes-snapshot.ts):
// prints one line per changed leaf, "<case>\t<json path>", sorted. A case whose
// text is not JSON is compared as a whole ("<case>\t<text>").
//   node payload-diff.mjs before.json after.json
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const out = [];
const parse = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return { __text: t };
  }
};
function walk(name, path, x, y) {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (obj(x) && obj(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(name, path ? `${path}.${k}` : k, x[k], y[k]);
    return;
  }
  out.push(`${name}\t${path || "<root>"}`);
}
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (!a[k] || !b[k]) {
    out.push(`${k}\t<case missing>`);
    continue;
  }
  if (a[k].status !== b[k].status) out.push(`${k}\tstatus`);
  walk(k, "", parse(a[k].text), parse(b[k].text));
}
console.log(out.sort().join("\n"));
