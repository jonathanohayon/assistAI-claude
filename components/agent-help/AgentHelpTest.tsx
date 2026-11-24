"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { agentHelpLinks, agentHelpRequests, HelpLink } from "@/components/agent-help/links";
import { clientAgentTestWords, type TestWords, type ToolsResponse } from "@/components/bricks/tools/tools-ui";

/** Where the help page sends the customer to set the address: the card. */
export const AGENT_CARD_HREF = agentHelpLinks(null).card;

const LINK =
  "inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]";
const BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]";

export type HelpTestState = "closed" | "loading" | "noUrl" | "ready";

/**
 * "Test my address": the brick's EXISTING test (POST
 * /api/dashboard/tools/client-agent/test, empty body = the SAVED address,
 * signed with the saved secret), its answer in the brick's words. No new API.
 *   closed  CLIENT_AGENT is off for this account (decided by the page on the
 *           server): no request at all, a line and the link to the card;
 *   noUrl   no saved address: the link to the card, no test spent;
 *   ready   the button.
 * Admin tenant view (`asUserId`, set by the admin route only): both requests
 * carry ?asUserId, so the test acts on the tenant viewed.
 */
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The load: which state the test area shows (GET on the account shown). */
export async function loadHelpTestState(asUserId: string | null, f: Fetch = fetch, signal?: AbortSignal): Promise<HelpTestState> {
  try {
    const r = await f(agentHelpRequests(asUserId).load, { signal, cache: "no-store" });
    if (!r.ok) return "noUrl";
    const d = (await r.json()) as ToolsResponse;
    return d.clientAgentTool?.visible !== true ? "closed" : d.tools.clientAgent?.url ? "ready" : "noUrl";
  } catch {
    return "noUrl";
  }
}

/** The test itself (POST on the account shown), in the brick's words. */
export async function runHelpTest(asUserId: string | null, f: Fetch = fetch): Promise<TestWords> {
  try {
    const res = await f(agentHelpRequests(asUserId).test, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return clientAgentTestWords(res.status, await res.json().catch(() => null));
  } catch {
    return { key: "generic" };
  }
}

export function AgentHelpTest({ open, asUserId = null }: { open: boolean; asUserId?: string | null }) {
  const [state, setState] = useState<HelpTestState>(open ? "loading" : "closed");
  const [test, setTest] = useState<TestWords | "running" | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    void loadHelpTestState(asUserId, fetch, ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setState(s);
    });
    return () => ctrl.abort();
  }, [open, asUserId]);

  const run = async () => {
    setTest("running");
    setTest(await runHelpTest(asUserId));
  };

  return <AgentHelpTestView state={state} test={test} onRun={() => void run()} asUserId={asUserId} />;
}

/** The view alone (rendered as-is by the tests). */
export function AgentHelpTestView({
  state,
  test,
  onRun,
  asUserId = null,
}: {
  state: HelpTestState;
  test: TestWords | "running" | null;
  onRun?: () => void;
  asUserId?: string | null;
}) {
  const links = agentHelpLinks(asUserId);
  const t = useTranslations("AgentHelp.test");
  const tTest = useTranslations("ToolsBrick.agent");
  const card = useTranslations("ClientAgentBrick")("title");
  const cardLink = (
    <HelpLink href={links.card} admin={links.admin} className={LINK} data-help-card-link>
      {t("toCard", { card })}
    </HelpLink>
  );
  if (state === "loading") {
    return (
      <p className="text-sm text-[#475569]" aria-busy="true">
        {t("loading")}
      </p>
    );
  }
  if (state === "closed" || state === "noUrl") {
    return (
      <div className="flex flex-col items-start gap-1" data-help-test={state}>
        <p className="text-sm text-[#475569]">{t(state, { card })}</p>
        {cardLink}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2" data-help-test="ready">
      <button type="button" className={BUTTON} onClick={onRun} disabled={test === "running"}>
        {test === "running" ? tTest("testing") : t("button")}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {test && test !== "running" && (
          <span className={test.key === "ok" ? "font-semibold text-[#047857]" : "text-[#92400e]"}>
            {test.key === "ok" ? tTest("test.ok", { ms: test.ms }) : tTest(`test.${test.key}`)}
          </span>
        )}
      </p>
      {cardLink}
    </div>
  );
}
