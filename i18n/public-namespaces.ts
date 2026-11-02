// Translation namespaces shipped to the browser on PUBLIC pages (landing,
// login, signup, verify-email, onboarding). [locale]/layout passes only
// these to NextIntlClientProvider: the full messages file is ~84 KB and the
// public pages need ~23 KB of it. The dashboard re-provides the full set
// (components/i18n/FullMessagesProvider). Server Components are unaffected
// (getTranslations reads the request config, not the client provider).
//
// scripts/tests/public-messages.test.ts walks the public routes' client
// imports and fails if a namespace they use is missing here.
export const PUBLIC_NAMESPACES = [
  "CTA",
  "FAQ",
  "Features",
  "Footer",
  "Hero",
  "Industries",
  "Integrations",
  "LocaleSwitcher",
  "Login",
  "Nav",
  "Onboarding",
  "OutboundCalling",
  "Performance",
  "Plans",
  "Pricing",
  "PricingComparison",
  "Security",
  "Signup",
  "SocialProof",
  "Support",
  "TwoMinutes",
  "VerifyEmail",
  "VoiceDemo",
  "VoiceStudio",
] as const;

export function pickNamespaces<M extends Record<string, unknown>>(
  messages: M,
  namespaces: readonly string[],
): Partial<M> {
  const out: Record<string, unknown> = {};
  for (const ns of namespaces) if (ns in messages) out[ns] = messages[ns];
  return out as Partial<M>;
}
