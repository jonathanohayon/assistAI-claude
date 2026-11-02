// Twilio webhook signature check (X-Twilio-Signature), without the Twilio SDK.
//
// Algorithm (twilio.com/docs/usage/security): HMAC-SHA1, keyed with the auth
// token, over the FULL public URL Twilio called followed by every POST param
// as name+value, sorted by name; base64. Unit-tested against a fixture in
// scripts/tests/twilio-signature.test.ts.
//
// Behind Railway the request URL is the internal host:8080, never what Twilio
// signed, so candidates are rebuilt from APP_URL and X-Forwarded-* headers.

import { createHmac, timingSafeEqual } from "node:crypto";

export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isValidTwilioSignature(args: {
  authToken: string;
  signature: string | null;
  urls: string[];
  params: Record<string, string>;
}): boolean {
  const { authToken, signature, urls, params } = args;
  if (!authToken || !signature) return false;
  return urls.some((u) => safeEqual(twilioSignature(authToken, u, params), signature));
}

/** Public URLs Twilio may have signed for this request, most likely first. */
export function candidateUrls(
  pathWithQuery: string,
  headers: Headers,
  appUrl: string | undefined,
): string[] {
  const out: string[] = [];
  if (appUrl) out.push(`${appUrl.replace(/\/$/, "")}${pathWithQuery}`);
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? "https";
    out.push(`${proto}://${host.replace(/:\d+$/, "")}${pathWithQuery}`);
  }
  return [...new Set(out)];
}
