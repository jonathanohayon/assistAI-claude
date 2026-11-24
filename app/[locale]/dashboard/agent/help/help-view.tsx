import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AgentHelpTest } from "@/components/agent-help/AgentHelpTest";
import { CopyBlock } from "@/components/agent-help/CopyBlock";
import { agentHelpLinks, HelpLink } from "@/components/agent-help/links";
import {
  CLIENT_AGENT_REQUEST_FIELDS,
  exampleRequestText,
  exampleResponseText,
  exampleServerText,
  helpFacts,
  type ExampleWords,
} from "@/lib/tools/client-agent-help";
import { clientAgentTestQuestion } from "@/lib/tools/client-agent-test";
import { CLIENT_AGENT_MODES } from "@/lib/tools/contract";

const CARD = "rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6";
const H2 = "font-display text-lg text-[var(--color-foreground)]";
const P = "mt-2 text-sm leading-relaxed text-[#334155]";
const H3 = "mt-4 text-sm font-semibold text-[var(--color-foreground)]";
// Code words stay left-to-right inside Hebrew sentences.
const code = (c: ReactNode) => (
  // inline-block: one LTR unit that never splits across RTL lines (it wraps inside only if wider than the line).
  <code dir="ltr" className="inline-block max-w-full break-all rounded bg-[var(--color-muted)] px-1 font-mono text-[12px] text-[var(--color-foreground)]">
    {c}
  </code>
);

/**
 * "Comment obtenir l'adresse de votre agent": the contract of the address
 * Tamara calls, from the code's own constants (lib/tools/client-agent-help.ts).
 * A server component (no "use client"): the contract constants come from a
 * server-only module; only the copy buttons and the test are client parts.
 * Never empty: every section renders whatever the switches; only the test
 * area depends on `testOpen` (CLIENT_AGENT for the account shown).
 * `asUserId`: the admin route only (/admin/users/[id]/agent/help, behind
 * requireAdminPage); the tenant route never passes one.
 */
export function AgentHelpView({
  locale,
  testOpen,
  asUserId = null,
  testLanguage,
}: {
  locale: string;
  testOpen: boolean;
  asUserId?: string | null;
  /** The account's primaryLanguage: the test route asks its question in it (unknown = fr). */
  testLanguage: string | null;
}) {
  const links = agentHelpLinks(asUserId);
  const t = useTranslations("AgentHelp");
  const tModes = useTranslations("ToolsBrick.agent.modes");
  const tNav = useTranslations("DashboardNav");
  const card = useTranslations("ClientAgentBrick")("title");
  const num = new Intl.NumberFormat(locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR");
  const seconds = num.format(helpFacts.budgetSeconds);
  const voiceSeconds = num.format(helpFacts.voiceBudgetSeconds);
  const stall = num.format(helpFacts.stallSeconds);
  const w: ExampleWords = {
    question: t("example.question"),
    callerSaid: t("example.callerSaid"),
    prevUser: t("example.prevUser"),
    prevAgent: t("example.prevAgent"),
    answer: t("example.answer"),
  };
  const copy = { copyLabel: t("copy"), copiedLabel: t("copied") };

  return (
    <div className="space-y-5" data-agent-help>
      <div>
        <HelpLink href={links.back} admin={links.admin} className="inline-flex min-h-11 items-center text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline">
          {t("back", { page: tNav("connect") })}
        </HelpLink>
        <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{t("title")}</h1>
      </div>

      <section className={CARD} aria-labelledby="help-what">
        <h2 id="help-what" className={H2}>
          {t("what.title")}
        </h2>
        <p className={P}>{t.rich("what.body", { c: code })}</p>
        <ul className="mt-3 space-y-2 text-sm text-[#334155]">
          {CLIENT_AGENT_MODES.map((m) => (
            <li key={m} data-mode={m}>
              {t.rich(`what.modes.${m}`, {
                label: tModes(m),
                b: (c) => <span className="font-semibold text-[var(--color-foreground)]">{c}</span>,
              })}
            </li>
          ))}
        </ul>
      </section>

      <section className={CARD} aria-labelledby="help-contract">
        <h2 id="help-contract" className={H2}>
          {t("contract.title")}
        </h2>

        <h3 className={H3}>{t("contract.methodTitle")}</h3>
        <p className={P}>
          {t.rich("contract.method", { c: code, ua: helpFacts.userAgent, header: helpFacts.header })}
        </p>

        <h3 className={H3}>{t("contract.fieldsTitle")}</h3>
        <dl className="mt-2 space-y-2 text-sm" data-fields>
          {CLIENT_AGENT_REQUEST_FIELDS.map((f) => (
            <div key={f} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3" data-field={f}>
              <dt className="shrink-0 sm:w-28">{code(f)}</dt>
              <dd className="m-0 text-[#334155]">{t.rich(`contract.fields.${f}`, { c: code, turns: helpFacts.historyTurns })}</dd>
            </div>
          ))}
        </dl>
        {/* The question comes from speech: names can be approximate (VP, after a real demo call). */}
        <p className={P} data-fact="speech">
          {t("contract.speechNote")}
        </p>

        <h3 className={H3}>{t("contract.responseTitle")}</h3>
        <p className={P}>{t.rich("contract.response", { c: code })}</p>

        <h3 className={H3}>{t("contract.timeTitle")}</h3>
        <p className={P} data-fact="budget">
          {t("contract.time", { seconds, voiceSeconds, stall })}
        </p>

        <h3 className={H3}>{t("contract.signatureTitle")}</h3>
        <p className={P} data-fact="signature">
          {t.rich("contract.signature", { c: code, header: helpFacts.header, card })}
        </p>

        <h3 className={H3}>{t("contract.errorsTitle")}</h3>
        <p className={P} data-fact="errors">
          {t.rich("contract.errors", { c: code, kb: helpFacts.maxKb })}
        </p>
      </section>

      <section className={CARD} aria-labelledby="help-example">
        <h2 id="help-example" className={H2}>
          {t("example.title")}
        </h2>
        <p className={P}>{t("example.intro")}</p>
        <div className="mt-4 space-y-4">
          <CopyBlock title={t("example.request")} code={exampleRequestText(locale, w)} {...copy} />
          <CopyBlock title={t("example.response")} code={exampleResponseText(w)} {...copy} />
          <CopyBlock title={t("example.server")} code={exampleServerText(w)} {...copy} />
        </div>
      </section>

      <section className={CARD} aria-labelledby="help-test">
        <h2 id="help-test" className={H2}>
          {t("test.title")}
        </h2>
        <p className={P}>
          {t.rich("test.body", {
            question: clientAgentTestQuestion(testLanguage ?? "fr"),
            // The question is in the ACCOUNT's language, which may differ from the page's: its own direction.
            q: (c) => <bdi dir="auto" data-test-question>{c}</bdi>,
          })}
        </p>
        <div className="mt-3">
          <AgentHelpTest open={testOpen} asUserId={asUserId} />
        </div>
      </section>

      <section className={CARD} aria-labelledby="help-none">
        <h2 id="help-none" className={H2}>
          {t("none.title")}
        </h2>
        <p className={P}>{t.rich("none.body", { c: code, card })}</p>
      </section>
    </div>
  );
}
