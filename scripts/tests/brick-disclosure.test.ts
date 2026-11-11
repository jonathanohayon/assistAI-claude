// Level 2 and level 3 of every brick use ONE disclosure (MoreSettings);
// level 3 ("Developer settings") starts collapsed, its content hidden until
// expanded, on every mount. Mock data only.
// Run with:  npx tsx scripts/tests/brick-disclosure.test.ts

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MoreSettings } from "../../components/bricks/MoreSettings";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const BRICKS = [
  "components/bricks/voice/VoiceBrick.tsx",
  "components/bricks/persona/PersonaBrick.tsx",
  "components/bricks/knowledge/KnowledgeBrick.tsx",
  "components/bricks/tools/ToolsBrick.tsx",
];

// 1. One shared component: the 4 bricks import it and put level 3 in it.
for (const f of BRICKS) {
  const src = read(f);
  assert.match(src, /import \{ MoreSettings \} from "@\/components\/bricks\/MoreSettings";/, `${f}: imports MoreSettings`);
  assert.equal(src.match(/<MoreSettings level=\{3\}>/g)?.length, 1, `${f}: level 3 is <MoreSettings level={3}>`);
  assert.doesNotMatch(src, /defaultOpen/, `${f}: never opened by default`);
  assert.doesNotMatch(src, /border-dashed/, `${f}: no always-open dashed block`);
}

// …and no other settings disclosure exists in the bricks: only MoreSettings
// builds a collapsible section (<details>, or a button controlling a region).
// (A list's "show all" toggle, e.g. the voice picker's, isn't a section.)
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : [],
  );
for (const f of walk("components/bricks")) {
  if (f === "components/bricks/MoreSettings.tsx") continue;
  assert.doesNotMatch(read(f), /<details\b|role="region"|aria-controls=/, `${f}: a second disclosure`);
}

// 2. Level 3 renders collapsed: button aria-expanded=false, content in a hidden region.
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
// Children passed as createElement arguments (typed loosely for that).
const Intl = NextIntlClientProvider as unknown as ComponentType<{ locale: string; messages: unknown; timeZone?: string; children?: ReactNode }>;
const More = MoreSettings as unknown as ComponentType<{ level?: 2 | 3; children?: ReactNode }>;
for (const [locale, title] of [
  ["fr", "Réglages développeur"],
  ["en", "Developer settings"],
  ["he", "הגדרות מפתח"],
] as const) {
  const html = renderToStaticMarkup(
    createElement(Intl, { locale, messages: messages(locale), timeZone: "UTC" }, createElement(More, { level: 3 }, createElement("p", { id: "secret" }, "MOCK LEVEL 3 CONTENT"))),
  );
  // The title may be wrapped (MoreSettings puts it in a span next to an optional summary).
  assert.match(html, new RegExp(`aria-expanded="false"[^>]*>(?:<span[^>]*>)?${title}`), `${locale}: titled and collapsed`);
  // The content sits inside the region that carries `hidden`.
  const region = /<div[^>]*role="region"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(region, /\bhidden=""/, `${locale}: region hidden`);
  assert.ok(html.indexOf("MOCK LEVEL 3 CONTENT") > html.indexOf(region), `${locale}: content inside the hidden region`);
}
// Level 2 keeps its title.
assert.match(
  renderToStaticMarkup(createElement(Intl, { locale: "fr", messages: messages("fr"), timeZone: "UTC" }, createElement(More, {}, "x"))),
  /aria-expanded="false"[^>]*>(?:<span[^>]*>)?Plus de réglages/,
);

console.log("ALL BRICK-DISCLOSURE TESTS PASSED");
