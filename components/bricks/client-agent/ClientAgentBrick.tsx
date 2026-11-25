"use client";

/**
 * Client-agent brick (F2): "Ask your agent" on its own, on Votre agent. It
 * was a row of the Tools brick, saved by the configuration page's save bar;
 * it now has its own card and its own save, through the SAME API with the
 * SAME body (tools-ui.ts clientAgentSaveRequest: PUT /api/dashboard/tools,
 * { tools: { clientAgent: … } }), so what is stored, and what the call
 * receives, is unchanged.
 *
 * Gate, as before: the page mounts it only where CLIENT_AGENT is on for the
 * account, and the brick shows only when the server says
 * `clientAgentTool.visible` (not in the DOM otherwise).
 *
 * The row: its switch, the agent's address, the mode, a connection test
 * (plain words only) and a WRITE-ONLY signing secret — generated in the
 * browser, shown once until the save, then only "set / not set". Switched on
 * with no secret at all, the server makes one and sends it in that save's
 * answer only (`generatedSecret`): shown once in the same box, kept in this
 * component's state only (no storage, no URL), gone on a reload.
 *
 * Preview (`sample`): the account doesn't own Votre agent. The brick renders
 * the sample answer and a sample test result, every control disabled; it
 * makes no request (no load, no save, no test: it never pings an address).
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { ChipGroup, FOCUS, HINT, LABEL } from "@/components/bricks/controls";
import { CapabilityRow } from "@/components/bricks/tools/CapabilityRow";
import {
  clientAgentRowVisible,
  clientAgentSaveRefusal,
  clientAgentSaveRequest,
  clientAgentSavedAnswer,
  clientAgentTestBody,
  clientAgentTestNeedsSave,
  clientAgentTestWords,
  clientAgentView,
  generateClientAgentSecret,
  secretState,
  type ClientAgentRefusal,
  type ScreenTools as Tools,
  type TestWords,
  type ToolsResponse,
} from "@/components/bricks/tools/tools-ui";
import { agentHelpLinks, HelpLink } from "@/components/agent-help/links";
import { CLIENT_AGENT_MODES, type ClientAgentMode } from "@/lib/tools/contract";

/** The help page for the address field ("Comment obtenir cette adresse ?"). */
export { AGENT_HELP_HREF } from "@/components/agent-help/links";

export interface ClientAgentSample {
  /** A GET /api/dashboard/tools answer (lib/preview-samples.ts). */
  served: ToolsResponse;
  /** The test line to show, as if a test had run. */
  test: TestWords;
}

const LINK = `inline-flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline ${FOCUS}`;
const SAVE =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#be185d] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9d174d] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2";

export function ClientAgentBrick({
  asUserId = null,
  sample,
  onSaved,
  initialGenerated = null,
}: {
  asUserId?: string | null;
  sample?: ClientAgentSample;
  /** C1b: called after a successful save (the connectors list re-reads its page). */
  onSaved?: () => void;
  /**
   * C1b: a secret the server generated in ANOTHER save's answer (the
   * connectors card's switch), handed over to be shown once in this brick's
   * own box. Memory only, like `generated`.
   */
  initialGenerated?: string | null;
}) {
  const t = useTranslations("ClientAgentBrick");
  const tTools = useTranslations("ToolsBrick");
  const tConfig = useTranslations("DashboardConfig");
  const locale = useLocale();
  const id = useId();
  const preview = sample !== undefined;
  const [served, setServed] = useState<ToolsResponse | null>(sample?.served ?? null);
  const [tools, setTools] = useState<Tools | null>(sample?.served.tools ?? null);
  const [base, setBase] = useState<Tools | null>(sample?.served.tools ?? null);
  const [refused, setRefused] = useState<ClientAgentRefusal | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // The server-generated secret, from one save's answer: memory only, shown once.
  const [generated, setGenerated] = useState<string | null>(initialGenerated);

  // Load: the same GET the configuration page made. Never in a preview.
  useEffect(() => {
    if (preview) return;
    const ctrl = new AbortController();
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    fetch(`/api/dashboard/tools${qs}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ToolsResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setServed(d);
        setTools(d.tools);
        setBase(d.tools);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [asUserId, preview]);

  // Unsaved settings are lost on a reload or a full navigation: ask first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as Window & { __idleLogout?: boolean }).__idleLogout) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (!served || !tools || !base) {
    return (
      <p className="text-sm text-[#475569]" aria-busy="true">
        {tTools("loading")}
      </p>
    );
  }
  // Same gate as the row had: only where the server says so.
  if (!clientAgentRowVisible("inbound", served)) return null;

  const onChange = (next: Tools) => {
    setTools(next);
    setDirty(true);
    setError(null);
  };

  const save = async () => {
    if (preview || saving) return;
    const req = clientAgentSaveRequest(base, tools, asUserId);
    setRefused(null);
    setError(null);
    if (!req) {
      setDirty(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(req.url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: req.body });
      const data = (await res.json().catch(() => null)) as ToolsResponse | null;
      if (!res.ok || !data?.tools) {
        // Our words next to the row; the unsaved values (a generated secret included) stay on screen.
        setRefused(clientAgentSaveRefusal(res.status, data));
        setError(tTools("saveError"));
        return;
      }
      // `served` never keeps generatedSecret; an answer without one changes nothing.
      const answer = clientAgentSavedAnswer(data);
      if (answer.generated) setGenerated(answer.generated);
      setServed(answer.served);
      setTools(data.tools);
      setBase(data.tools);
      setDirty(false);
      onSaved?.();
      setSavedAt(new Date().toLocaleTimeString(locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR"));
    } catch {
      setError(tTools("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="client-agent"
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id={`${id}-title`} className="font-display text-lg text-[var(--color-foreground)]">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("intro")}</p>
      {/* Preview: one fieldset disables every control of the row. */}
      <fieldset disabled={preview} className="m-0 mt-4 min-w-0 border-0 p-0">
        <ClientAgentRow
          served={served}
          tools={tools}
          onChange={onChange}
          asUserId={asUserId}
          refused={refused}
          sampleTest={sample?.test}
          generated={generated}
          onGeneratedDone={() => setGenerated(null)}
        />
      </fieldset>
      {!preview && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <p role="status" aria-live="polite" className="text-xs font-medium">
            {error ? (
              <span className="font-semibold text-[#b91c1c]">{error}</span>
            ) : dirty ? (
              <span className="font-semibold text-[#be185d]">{tConfig("unsavedChanges")}</span>
            ) : savedAt ? (
              <span className="text-[#0e7490]">{tConfig("savedAt", { time: savedAt })}</span>
            ) : null}
          </p>
          <button type="button" className={SAVE} onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? tConfig("saving") : tConfig("saveButton")}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The "Ask your agent" row (the old Tools-brick row, unchanged): its switch,
 * state in words and settings. Pure view over the brick's state.
 */
export function ClientAgentRow({
  served,
  tools,
  onChange,
  asUserId,
  refused,
  sampleTest,
  generated = null,
  onGeneratedDone,
}: {
  served: ToolsResponse;
  tools: Tools;
  onChange: (next: Tools) => void;
  asUserId?: string | null;
  refused: ClientAgentRefusal | null;
  sampleTest?: TestWords;
  /** The secret the server generated in the last save's answer (memory only). */
  generated?: string | null;
  onGeneratedDone?: () => void;
}) {
  return (
    <ul className="flex flex-col rounded-2xl border border-[#e2e8f0] bg-white">
      <CapabilityRow
        v={clientAgentView(served, tools)}
        checked={tools.clientAgent.enabled}
        onToggle={(enabled) => onChange({ ...tools, clientAgent: { ...tools.clientAgent, enabled } })}
        number={null}
        kind="inbound"
        action={
          <ClientAgentSettings
            tools={tools}
            storedUrl={served.tools.clientAgent?.url ?? ""}
            onChange={onChange}
            asUserId={asUserId}
            refused={refused}
            sampleTest={sampleTest}
            generated={generated}
            onGeneratedDone={onGeneratedDone}
          />
        }
      />
    </ul>
  );
}

const BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const ALERT = "rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]";
// "https://" kept left-to-right inside Hebrew sentences.
const ltr = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;

/**
 * "Ask your agent" settings: address, mode, signing secret, connection test.
 * Everything is the screen's unsaved state until the brick's Save. With a
 * `sampleTest` (preview) the test line shows it and the test never runs.
 */
function ClientAgentSettings({
  tools,
  storedUrl,
  onChange,
  asUserId,
  refused,
  sampleTest,
  generated,
  onGeneratedDone,
}: {
  tools: Tools;
  /** The address the server has (to know when a test can't be meaningful yet). */
  storedUrl: string;
  onChange: (next: Tools) => void;
  asUserId?: string | null;
  refused: ClientAgentRefusal | null;
  /** Preview: the sample result shown in place of a test (never run). */
  sampleTest?: TestWords;
  generated: string | null;
  onGeneratedDone?: () => void;
}) {
  const t = useTranslations("ToolsBrick.agent");
  const id = useId();
  const ca = tools.clientAgent;
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  // The new secret stays on screen until the user says it's copied (or leaves
  // the page) — NOT tied to the save: a box that vanished after a partly
  // failed save, before it was copied, would force a regenerate.
  const [revealed, setRevealed] = useState<string | null>(null);
  const testBlocked = clientAgentTestNeedsSave(tools, storedUrl);
  // What the box shows: the secret generated here, else the one the server
  // generated on the last save, else a new one in the draft.
  const shown = revealed ?? generated ?? (typeof ca.secret === "string" ? ca.secret : null);
  const [test, setTest] = useState<TestWords | "running" | null>(sampleTest ?? null);
  const secret = secretState(tools);

  const set = (patch: Partial<Tools["clientAgent"]>) => onChange({ ...tools, clientAgent: { ...ca, ...patch } });
  // Back to what the server has: no `secret` key at all (the save omits it).
  const keepStoredSecret = () => {
    const { secret: _drop, ...rest } = ca;
    void _drop;
    onChange({ ...tools, clientAgent: rest });
  };
  const generate = () => {
    setConfirming(false);
    setCopied(false);
    const s = generateClientAgentSecret();
    onGeneratedDone?.();
    setRevealed(s);
    set({ secret: s });
  };

  const runTest = async () => {
    // A preview never pings an address.
    if (sampleTest) return;
    const body = clientAgentTestBody(tools);
    // Nothing to test: say so without spending one of the account's tests.
    if (!body.url) return setTest({ key: "no_agent_url" });
    setTest("running");
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    try {
      const res = await fetch(`/api/dashboard/tools/client-agent/test${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setTest(clientAgentTestWords(res.status, await res.json().catch(() => null)));
    } catch {
      setTest({ key: "generic" });
    }
  };

  const urlId = `${id}-url`;
  const urlHintId = `${id}-url-hint`;
  const urlErrorId = `${id}-url-error`;
  const secretLabelId = `${id}-secret`;

  return (
    <div className="mt-3 flex flex-col gap-4">
      {/* A refused save, in our words next to the row (never the server's message). */}
      {refused === "disabled" && (
        <p role="alert" className={ALERT}>
          {t("refused.disabled")}
        </p>
      )}

      <div>
        <label htmlFor={urlId} className={LABEL}>
          {t("url")}
        </label>
        <input
          id={urlId}
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={ca.url}
          aria-describedby={refused === "unsafeUrl" ? `${urlHintId} ${urlErrorId}` : urlHintId}
          aria-invalid={refused === "unsafeUrl" || undefined}
          onChange={(e) => {
            setTest(null);
            set({ url: e.target.value });
          }}
          className={`mt-1 block min-h-11 w-full rounded-xl border bg-white px-3 text-start text-sm text-[#18181b] ${refused === "unsafeUrl" ? "border-[#dc2626]" : "border-[#cbd5e1]"} ${FOCUS}`}
        />
        <p id={urlHintId} className={HINT}>
          {t.rich("urlHint", { l: ltr })}
        </p>
        {/* A link, not a control: it stays usable in the read-only preview too.
            Admin tenant view: the admin route, so the help page tests THIS tenant. */}
        <HelpLink href={agentHelpLinks(asUserId).help} admin={Boolean(asUserId)} className={LINK} data-agent-help-link>
          {t("howToGet")}
        </HelpLink>
        {refused === "unsafeUrl" && (
          <p id={urlErrorId} role="alert" className={`mt-2 ${ALERT}`}>
            {t.rich("refused.unsafeUrl", { l: ltr })}
          </p>
        )}
      </div>

      <div>
        <ChipGroup
          label={t("mode")}
          options={CLIENT_AGENT_MODES.map((m) => ({ id: m, label: t(`modes.${m}`) }))}
          selected={ca.mode}
          onPick={(m) => set({ mode: m as ClientAgentMode })}
        />
        <p className={`mt-2 ${HINT}`}>{t(`modeHint.${ca.mode}`)}</p>
      </div>

      <div>
        <p id={secretLabelId} className={LABEL}>
          {t("secret")}
        </p>
        <p className={HINT}>{t("secretHint")}</p>
        {/* Only ever "set / not set" from the server: the value never comes back. */}
        <p className="mt-1 text-sm text-[#18181b]" aria-live="polite">
          {secret === "set" ? t("secretSet") : secret === "removing" ? t("secretRemoving") : secret === "unset" ? t("secretUnset") : null}
        </p>

        {shown !== null && (
          <div className="mt-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3" role="group" aria-labelledby={`${id}-new`}>
            <p id={`${id}-new`} className="text-sm font-semibold text-[#78350f]">
              {t("newSecretLabel")}
            </p>
            <code dir="ltr" className="mt-1 block select-all break-all rounded-lg bg-white px-2 py-2 font-mono text-sm text-[#18181b]">
              {shown}
            </code>
            <p className="mt-2 text-sm font-semibold text-[#78350f]">{t("copyNow")}</p>
            {secret === "new" && <p className={HINT}>{t("saveToKeep")}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  navigator.clipboard?.writeText(shown).then(
                    () => setCopied(true),
                    () => {},
                  );
                }}
              >
                {t("copy")}
              </button>
              {/* Before the save: drop it. After: only "C'est copié" closes the box. */}
              {secret === "new" ? (
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setRevealed(null);
                    keepStoredSecret();
                  }}
                >
                  {t("undo")}
                </button>
              ) : (
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    setRevealed(null);
                    onGeneratedDone?.();
                  }}
                >
                  {t("copiedDone")}
                </button>
              )}
              <span className="text-sm text-[#047857]" aria-live="polite">
                {copied ? t("copied") : ""}
              </span>
            </div>
          </div>
        )}

        {/* Regenerating breaks the secret the customer's agent uses: ask first. */}
        {shown !== null && secret !== "new" ? null : confirming ? (
          <div role="group" aria-labelledby={`${id}-confirm`} className="mt-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <p id={`${id}-confirm`} role="alert" className="text-sm text-[#18181b]">
              {t("confirmRegenerate")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BUTTON} onClick={generate}>
                {t("confirmYes")}
              </button>
              <button type="button" className={BUTTON} onClick={() => setConfirming(false)}>
                {t("confirmNo")}
              </button>
            </div>
          </div>
        ) : (
          secret !== "new" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BUTTON}
                aria-describedby={secretLabelId}
                onClick={() => (secret === "set" ? setConfirming(true) : generate())}
              >
                {secret === "set" ? t("regenerate") : t("generate")}
              </button>
              {secret === "set" && (
                <button type="button" className={LINK} aria-describedby={secretLabelId} onClick={() => set({ secret: null })}>
                  {t("remove")}
                </button>
              )}
              {secret === "removing" && (
                <button type="button" className={LINK} onClick={keepStoredSecret}>
                  {t("undo")}
                </button>
              )}
            </div>
          )
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={`${BUTTON} self-start`}
          onClick={runTest}
          disabled={test === "running" || testBlocked}
          aria-describedby={testBlocked ? `${id}-test-save` : undefined}
        >
          {test === "running" ? t("testing") : t("testButton")}
        </button>
        {/* Changed address + kept secret: the test would run unsigned while the live call is signed. */}
        {testBlocked && (
          <p id={`${id}-test-save`} className={HINT}>
            {t("saveFirstToTest")}
          </p>
        )}
        {/* One calm line, in our words only: never an address, a remote body or a status number. */}
        <p role="status" aria-live="polite" className="min-h-5 text-sm">
          {test && test !== "running" && (
            <span className={test.key === "ok" ? "font-semibold text-[#047857]" : "text-[#92400e]"}>
              {test.key === "ok" ? t("test.ok", { ms: test.ms }) : t(`test.${test.key}`)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
