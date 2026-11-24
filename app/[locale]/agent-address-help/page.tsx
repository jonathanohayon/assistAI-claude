import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AgentHelpView } from "@/components/agent-help/AgentHelpView";
import { Footer } from "@/components/marketing/Footer";
import { Nav } from "@/components/marketing/Nav";

// PUBLIC "Comment obtenir l'adresse de votre agent" (VP): the generic part of
// the dashboard help page, for the customer's technical person, who has no
// account. No sign-in, no account, no database: the SAME view as the
// dashboard (components/agent-help/AgentHelpView.tsx) in its public variant,
// without the test area. noindex, nofollow; the repo has no sitemap.
// The public site's chrome (marketing Nav + Footer, as the landings), not
// the dashboard's.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "AgentHelp" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function PublicAgentHelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)]">
      {/* No section links: this page isn't the home. */}
      <Nav nav={{ links: [], signupHref: "/signup" }} overLight />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-28 sm:px-6">
        <AgentHelpView locale={locale} variant="public" />
      </main>
      <Footer anchorBase="/" />
    </div>
  );
}
