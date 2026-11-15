// Verified contacts, N2: the confirmation-code email (pure rendering, so the
// unit test checks every locale). Neutral text: no product, no supplier
// name; the code is the only variable. Strings: messages/*.json
// Email.contactCode.

export type CodeEmailLocale = "fr" | "he" | "en";
export type CodeEmailKey = "subject" | "heading" | "intro" | "expires" | "ignore";
export type CodeEmailStrings = (key: CodeEmailKey) => string;

const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function renderContactCodeEmail(
  input: { locale: CodeEmailLocale; code: string },
  t: CodeEmailStrings,
): { subject: string; text: string; html: string } {
  const dir = input.locale === "he" ? "rtl" : "ltr";
  const code = escapeHtml(input.code);
  const text = `${t("heading")}\n\n${t("intro")}\n\n    ${input.code}\n\n${t("expires")}\n\n${t("ignore")}`;
  // The code stays left-to-right inside a Hebrew paragraph.
  const html = `<div dir="${dir}" lang="${input.locale}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a;text-align:${dir === "rtl" ? "right" : "left"};">
  <h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(t("heading"))}</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 24px;color:#374151;">${escapeHtml(t("intro"))}</p>
  <div dir="ltr" style="font-family:'SF Mono',Menlo,Monaco,monospace;font-size:36px;letter-spacing:0.3em;font-weight:600;text-align:center;background:#f3f4f6;padding:20px 24px;border-radius:12px;color:#111827;unicode-bidi:isolate;">${code}</div>
  <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#6b7280;">${escapeHtml(t("expires"))}<br/>${escapeHtml(t("ignore"))}</p>
</div>`;
  return { subject: t("subject"), text, html };
}
