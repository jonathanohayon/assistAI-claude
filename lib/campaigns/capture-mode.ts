// Site switch for campaign field capture (M3a): env CAMPAIGN_CAPTURE =
//   unset / anything else = "off" (default): nothing runs, nothing is written,
//     every response is byte-identical to before the feature;
//   "on": after a connected campaign call, the campaign's extraction_schema
//     fields are read from the transcript into campaign_calls.extracted, and
//     the results route exposes them as `captured`.
// Read ONLY here; the campaign-result and results routes both call this.
export type CaptureMode = "off" | "on";

export function captureMode(env: Record<string, string | undefined> = process.env): CaptureMode {
  const v = (env.CAMPAIGN_CAPTURE ?? "").trim().toLowerCase();
  return v === "on" ? "on" : "off";
}
