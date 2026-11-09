// Splits the Hero headline around its highlighted phrase. The phrase can be
// several words ("unanswered call", "שיחה שלא נענתה") and is highlighted as
// one unit; punctuation right after it (".") sticks to it instead of
// floating as its own word. Unit-tested in scripts/tests/hero-title.test.ts.

export const EMPHASIS_SLOT = "\u0001";

export interface HeroToken {
  text: string;
  emphasis?: boolean;
  /** Punctuation glued after the highlighted phrase (not highlighted). */
  trailing?: string;
}

export function heroTitleTokens(template: string, emphasis: string): HeroToken[] {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).map((text) => ({ text }));
  const at = template.indexOf(EMPHASIS_SLOT);
  if (at === -1) return words(template);
  const before = template.slice(0, at);
  const after = template.slice(at + EMPHASIS_SLOT.length);
  const punct = /^[^\s\p{L}\p{N}]+/u.exec(after)?.[0] ?? "";
  return [
    ...words(before),
    { text: emphasis.trim(), emphasis: true, ...(punct ? { trailing: punct } : {}) },
    ...words(after.slice(punct.length)),
  ];
}
