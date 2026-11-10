// "📞 Questions? Call us: <number>" line appended to the client WhatsApp
// messages (call recap + J-1 reminder). Pure. WhatsApp makes the E.164
// number tappable, so the client reaches the tenant's AI in one tap.
//
// No new Meta approval: the current client/reminder templates carry the
// whole text in {{1}}. The line is appended INSIDE the 1000-char template
// variable: the main text is trimmed, never the line.

import { ltrIsolate } from "@/lib/phone-utils";

export type CallLineLang = "fr" | "he" | "en";

export const TEMPLATE_VAR_MAX = 1000;

const E164 = /^\+[1-9]\d{6,14}$/;

export function callUsLine(lang: string, number: string): string {
  if (!E164.test(number)) return "";
  switch (lang) {
    case "he":
      // ltrIsolate keeps the "+" in front of the number inside RTL text.
      return `📞 יש שאלה? התקשרו אלינו: ${ltrIsolate(number)}`;
    case "en":
      return `📞 Questions? Call us: ${number}`;
    default:
      return `📞 Une question ? Appelez-nous : ${number}`;
  }
}

/** Text + call line, the whole thing ≤ max chars; the line is never cut. */
export function withCallUsLine(
  text: string,
  lang: string,
  number: string | null | undefined,
  max = TEMPLATE_VAR_MAX,
): string {
  const line = number ? callUsLine(lang, number) : "";
  if (!line) return text.slice(0, max);
  const room = max - line.length - 2; // "\n\n"
  const body = text.length > room ? text.slice(0, Math.max(0, room - 1)).trimEnd() + "…" : text;
  return `${body}\n\n${line}`;
}
