"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type Ref } from "react";

import {
  brainSaveError,
  brainSavePlan,
  EMPTY_BRAIN_VIEW,
  toBrainState,
  type BrainError,
  type BrainErrorAt,
  type BrainResponse,
  type BrainState,
  type BrainView,
} from "./agent-brain-ui";

/**
 * Who answers the phone: the Tamara persona, or the account's own agent.
 *
 * The setting is explicit because its consequences are: in external mode the
 * persona configured above is not used at all. Saying so here keeps a tenant
 * from editing the persona for hours without understanding why their agent
 * ignores it.
 *
 * Since #253 the webhook url is admin-only (SSRF): a tenant never sees an
 * input for it, only a calm "configured by the Tamara team" line when one
 * exists. The signing secret is write-only for everyone.
 */

const API = "/api/dashboard/agent-brain";

export function AgentBrainSection() {
  const [state, setState] = useState<BrainState>({ view: EMPTY_BRAIN_VIEW });
  const [urlDraft, setUrlDraft] = useState("");
  const [secretDraft, setSecretDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BrainError | null>(null);
  // Ticked but not stored yet: the agent waits for an address (no request
  // was sent, or the server refused to switch it on). The box stays ticked
  // with the reason under it; Save sends the switch-on with the address.
  const [pendingOn, setPendingOn] = useState(false);
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  /** A message under its control; "address first" also puts the cursor in the address field. */
  const showError = (e: BrainError) => {
    setError(e);
    if (e.key === "addressRequired") {
      setPendingOn(true);
      // After the render that shows the line (the field exists for an admin only).
      setTimeout(() => urlRef.current?.focus(), 0);
    }
  };

  const apply = (d: BrainResponse | null) => {
    // The raw answer (which may carry the secret) is dropped right here.
    const next = toBrainState(d);
    setState(next);
    setUrlDraft(next.view.url);
  };

  useEffect(() => {
    fetch(API)
      .then((r) => (r.ok ? (r.json() as Promise<BrainResponse>) : null))
      .then((d) => {
        apply(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const save = async (from: BrainErrorAt, next: { enabled: boolean; url?: string; secret?: string }) => {
    setError(null);
    setSaved(false);
    const plan = brainSavePlan(state, next);
    if ("refuse" in plan) {
      // No usable address: nothing is sent, the reason shows under the switch.
      showError(plan.refuse);
      return false;
    }
    setBusy(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.put),
      });
      const d = (await res.json().catch(() => null)) as BrainResponse | null;
      const err = brainSaveError(res.status, d, { urlEditable: state.view.urlEditable, from, sent: plan.put });
      // A 200 that stored the agent off when we asked on still updates the
      // rest of the view; the box stays ticked with the reason under it.
      if (res.ok && d && typeof d.error !== "string") apply(d);
      if (err) {
        showError(err);
        return false;
      }
      setPendingOn(false);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      return true;
    } catch {
      setError({ at: from, key: "generic" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Checks the endpoint answers the contract before relying on it (admin only). */
  const test = async () => {
    setProbe({ kind: "pending" });
    try {
      const res = await fetch(urlDraft, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: "dashboard_probe",
          turn_id: 1,
          language: "fr",
          transcript: "Bonjour, ceci est un test depuis le dashboard.",
          history: [],
        }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: unknown } | null;
      setProbe(
        typeof data?.reply === "string" && data.reply.trim()
          ? { kind: "reply", reply: data.reply.slice(0, 120) }
          : { kind: "noReply", status: res.status },
      );
    } catch {
      // Often CORS: the browser can't reach an endpoint that doesn't allow
      // this origin, while the worker calls server-side and isn't affected.
      setProbe({ kind: "unreachable" });
    }
  };

  if (!loaded) return <AgentBrainLoading />;

  return (
    <AgentBrainView
      view={state.view}
      urlDraft={urlDraft}
      secretDraft={secretDraft}
      busy={busy}
      saved={saved}
      error={error}
      probe={probe}
      pendingOn={pendingOn}
      urlRef={urlRef}
      onToggle={(enabled) => {
        // Unticking a switch that was never stored on: nothing to send.
        if (!enabled && pendingOn && !state.view.enabled) {
          setPendingOn(false);
          setError(null);
          return;
        }
        void save("toggle", { enabled, url: urlDraft });
      }}
      onUrlChange={setUrlDraft}
      onSaveUrl={() => void save("url", { enabled: state.view.enabled || pendingOn, url: urlDraft })}
      onTest={() => void test()}
      onSecretChange={setSecretDraft}
      onSaveSecret={async () => {
        if (!secretDraft.trim()) return;
        const ok = await save("secret", { enabled: state.view.enabled, url: urlDraft, secret: secretDraft });
        if (ok) setSecretDraft("");
      }}
    />
  );
}

function AgentBrainLoading() {
  const t = useTranslations("AgentBrain");
  return <p className="mt-4 text-xs text-[var(--color-muted-foreground)]">{t("loading")}</p>;
}

export type Probe =
  | { kind: "pending" }
  | { kind: "reply"; reply: string }
  | { kind: "noReply"; status: number }
  | { kind: "unreachable" };

export type AgentBrainViewProps = {
  view: BrainView;
  urlDraft: string;
  secretDraft: string;
  busy: boolean;
  saved: boolean;
  /** The message to show, under the control it belongs to. */
  error: BrainError | null;
  probe: Probe | null;
  /** Ticked but not stored yet (waiting for an address): the box shows ticked. */
  pendingOn?: boolean;
  urlRef?: Ref<HTMLInputElement>;
  onToggle: (enabled: boolean) => void;
  onUrlChange: (url: string) => void;
  onSaveUrl: () => void;
  onTest: () => void;
  onSecretChange: (secret: string) => void;
  onSaveSecret: () => void;
};

/**
 * The section itself, stateless so a test can render it to static HTML.
 * It receives a BrainView: there is no secret value to render, and no url
 * unless the viewer may edit it.
 */
export function AgentBrainView({ urlRef, ...props }: AgentBrainViewProps) {
  const { view, busy, error } = props;
  const t = useTranslations("AgentBrain");
  const ids = useId();
  const secretStatusId = `${ids}-secret-status`;
  // Each message sits under the control that caused it (never at the bottom of the card).
  const errorId = (at: BrainErrorAt) => `${ids}-error-${at}`;
  const errorLine = (at: BrainErrorAt) =>
    error?.at === at ? (
      <p id={errorId(at)} role="alert" data-error-at={at} className="mt-2 text-xs text-red-700">
        {t(`errors.${error.key}`)}
      </p>
    ) : null;
  const describedBy = (at: BrainErrorAt, ...more: string[]) =>
    [...more, ...(error?.at === at ? [errorId(at)] : [])].join(" ") || undefined;

  const btn =
    "min-h-10 rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-50";
  const btnPrimary = `${btn} bg-[var(--color-foreground)] text-white`;
  const btnGhost = `${btn} border border-[var(--color-border)] hover:bg-[var(--color-muted)]`;

  // A tenant with no webhook can't set one up: no form at all (no switch,
  // secret, signature sentence or contract), just who can connect one. The
  // section's title and lead sentence come from the page. Kept as a full
  // view if the agent is somehow on, so it can still be switched off.
  // This is the only case where the switch couldn't be used: it is then not
  // rendered at all, so a rendered switch is always usable (except while a
  // save is in flight).
  if (!view.urlEditable && !view.urlConfigured && !view.enabled) {
    return <p className="mt-4 text-sm text-[var(--color-foreground)]">{t("connectViaTeam")}</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={view.enabled || props.pendingOn === true}
            disabled={busy}
            aria-describedby={describedBy("toggle")}
            onChange={(e) => props.onToggle(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            <span className="block text-sm font-medium text-[var(--color-foreground)]">{t("toggleLabel")}</span>
            <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">{t("toggleHint")}</span>
          </span>
        </label>
        {errorLine("toggle")}

        {view.enabled && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            {t("personaUnused")}
          </p>
        )}

        {view.urlEditable ? (
          <div className="mt-4">
            <label htmlFor={`${ids}-url`} className="block text-xs font-medium text-[var(--color-foreground)]">
              {t("urlLabel")}
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                ref={urlRef}
                id={`${ids}-url`}
                type="url"
                aria-invalid={error?.at === "url" || undefined}
                aria-describedby={describedBy("url")}
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                placeholder="https://api.example.com/agent/reply"
                value={props.urlDraft}
                onChange={(e) => props.onUrlChange(e.target.value)}
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-xs"
              />
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={props.onSaveUrl} disabled={busy} className={btnPrimary}>
                  {t("save")}
                </button>
                <button
                  type="button"
                  onClick={props.onTest}
                  disabled={!props.urlDraft.startsWith("http")}
                  className={btnGhost}
                >
                  {t("test")}
                </button>
              </div>
            </div>
          </div>
        ) : view.urlConfigured ? (
          <p className="mt-4 rounded-lg bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-foreground)]">
            {t("configuredByTeam")}
          </p>
        ) : (
          <p className="mt-4 text-xs text-[var(--color-muted-foreground)]">{t("connectViaTeam")}</p>
        )}
        {errorLine("url")}

        {/* Write-only signing secret: its state, never its value. */}
        <div className="mt-4">
          <label htmlFor={`${ids}-secret`} className="block text-xs font-medium text-[var(--color-foreground)]">
            {t("secretLabel")}
          </label>
          <p id={secretStatusId} className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            {view.secretSet ? t("secretSet") : t("secretNotSet")}
          </p>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={`${ids}-secret`}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={t("secretPlaceholder")}
              aria-describedby={describedBy("secret", secretStatusId)}
              value={props.secretDraft}
              onChange={(e) => props.onSecretChange(e.target.value)}
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={props.onSaveSecret}
              disabled={busy || !props.secretDraft.trim()}
              className={`${btnGhost} shrink-0`}
            >
              {t("secretSave")}
            </button>
          </div>
          {errorLine("secret")}
          <p className="mt-1.5 text-[11px] text-[var(--color-muted-foreground)]">
            {t.rich("secretHelp", {
              code: (chunks) => (
                <span dir="ltr" className="inline-block font-monotext-[var(--color-foreground)]">
                  {chunks}
                </span>
              ),
            })}
          </p>
        </div>

        <p role="status" aria-live="polite" className="mt-2 text-xs text-emerald-700 empty:hidden">
          {props.saved ? t("saved") : ""}
        </p>
        {props.probe && (
          <p className="mt-2 rounded-lg bg-[var(--color-muted)] px-3 py-2 text-[11px] break-words text-[var(--color-foreground)]">
            {props.probe.kind === "pending"
              ? "…"
              : props.probe.kind === "reply"
                ? t("probeReply", { reply: props.probe.reply })
                : props.probe.kind === "noReply"
                  ? t("probeNoReply", { status: props.probe.status })
                  : t("probeUnreachable")}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-xs">
        <p className="font-medium text-[var(--color-foreground)]">{t("contractTitle")}</p>
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 font-mono text-[11px] leading-relaxed"
        >
          {`POST ${(view.urlEditable && props.urlDraft) || "<agent-url>"}
{ "call_id": "…", "turn_id": 3, "language": "fr",
  "transcript": "…", "history": [{ "role": "user", "text": "…" }] }

→ 200 { "reply": "…" }   < 2 s`}
        </pre>
        <p className="mt-2 text-[var(--color-muted-foreground)]">{t("contractFoot")}</p>
      </div>
    </div>
  );
}
