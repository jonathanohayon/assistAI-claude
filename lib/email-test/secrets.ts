// Values redacted from logged email-provider errors (server-only).
export function emailSenderSecrets(): string[] {
  return [process.env.RESEND_API_KEY ?? ""].filter(Boolean);
}
