"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";

import { showLevel3 } from "@/components/bricks/level3";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";

/**
 * The agent's public URL: paste it into an external voice client so this
 * agent answers the phone.
 *
 * The token in the URL is stored hashed (lib/agent-tokens.ts), so it is shown
 * ONCE, right after the POST that creates or regenerates it, like the API key.
 * The GET only returns non-secret status ({ exists, createdAt, hint }). The
 * token lives in React state only: never in browser storage, never in the
 * contract sample, and a reload drops it.
 *
 * Engineering-facing, so it is level-3 content: shown only when the viewer's
 * developer mode is on (admins always see it, same rule as every brick).
 * Off means the card is not in the DOM and the status is never fetched.
 */
export function AgentUrlCard({ isAdmin }: { isAdmin: boolean }) {
  const dev = useDeveloperMode();
  return <AgentUrlCardGate isAdmin={isAdmin} developerMode={dev.on} />;
}

/** The gate itself, without the store (rendered as-is by the tests). */
export function AgentUrlCardGate({ isAdmin, developerMode }: { isAdmin: boolean; developerMode: boolean }) {
  const t = useTranslations("AgentUrl");
  if (!showLevel3({ isAdmin, developerMode })) return null;
  return (
    <section
      aria-labelledby="agent-url-title"
      className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="agent-url-title" className="font-display text-lg text-[var(--color-foreground)]">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("desc")}</p>
      <AgentUrlSection />
    </section>
  );
}

// ---------------------------------------------------------------------------
// State (pure, exported for the tests)
// ---------------------------------------------------------------------------

export type AgentUrlStatus = { exists: boolean; createdAt: string | null; hint: string | null };

export type AgentUrlState = {
  phase: "loading" | "ready" | "loadError";
  status: AgentUrlStatus;
  /** The plain token, present only right after a successful POST. */
  revealed: string | null;
  confirming: boolean;
  busy: boolean;
  error: "create" | "regenerate" | null;
};

export type AgentUrlAction =
  | { type: "load" }
  | { type: "loaded"; status: AgentUrlStatus }
  | { type: "loadFailed" }
  | { type: "askRegenerate" }
  | { type: "cancelRegenerate" }
  | { type: "submit" }
  | { type: "created"; token: string; status: AgentUrlStatus }
  | { type: "createFailed" };

export const initialAgentUrlState: AgentUrlState = {
  phase: "loading",
  status: { exists: false, createdAt: null, hint: null },
  revealed: null,
  confirming: false,
  busy: false,
  error: null,
};

export function agentUrlReducer(s: AgentUrlState, a: AgentUrlAction): AgentUrlState {
  switch (a.type) {
    case "load":
      return { ...s, phase: "loading" };
    case "loaded":
      return { ...s, phase: "ready", status: a.status };
    case "loadFailed":
      return { ...s, phase: "loadError" };
    case "askRegenerate":
      // Regenerating an existing URL always goes through the confirm first.
      return s.status.exists ? { ...s, confirming: true, error: null } : s;
    case "cancelRegenerate":
      return { ...s, confirming: false };
    case "submit":
      return { ...s, busy: true, error: null };
    case "created":
      return { ...s, phase: "ready", busy: false, confirming: false, revealed: a.token, status: a.status, error: null };
    case "createFailed":
      return { ...s, busy: false, confirming: false, error: s.status.exists ? "regenerate" : "create" };
  }
}

/** Accepts only the documented status shape; anything else is a failure. */
function parseStatus(d: unknown): AgentUrlStatus | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.exists !== "boolean") return null;
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : null;
  const hint = typeof o.hint === "string" ? o.hint : null;
  return { exists: o.exists, createdAt, hint };
}

type FetchLike = (input: string, init?: { method?: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** GET the status. Never returns server text: null means "failed". */
export async function fetchAgentUrlStatus(f: FetchLike): Promise<AgentUrlStatus | null> {
  try {
    const res = await f("/api/dashboard/agent-url");
    if (!res.ok) return null;
    return parseStatus(await res.json());
  } catch {
    return null;
  }
}

/** POST (create or regenerate). The only response that carries the token. */
export async function postAgentUrl(f: FetchLike): Promise<{ token: string; status: AgentUrlStatus } | null> {
  try {
    const res = await f("/api/dashboard/agent-url", { method: "POST" });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown> | null;
    const status = parseStatus(d);
    const token = d && typeof d.token === "string" && d.token ? d.token : null;
    if (!status || !token) return null;
    return { token, status: { ...status, exists: true } };
  } catch {
    return null;
  }
}

export function agentUrlFor(origin: string, token: string): string {
  return `${origin}/api/v1/agent/${token}`;
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export function AgentUrlSection() {
  const [state, dispatch] = useReducer(agentUrlReducer, initialAgentUrlState);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    dispatch({ type: "load" });
    fetchAgentUrlStatus(fetch).then((status) =>
      dispatch(status ? { type: "loaded", status } : { type: "loadFailed" }),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window is only available after mount (SSR-safe)
    setOrigin(window.location.origin);
    load();
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [load]);

  const submit = async () => {
    dispatch({ type: "submit" });
    const r = await postAgentUrl(fetch);
    dispatch(r ? { type: "created", token: r.token, status: r.status } : { type: "createFailed" });
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <AgentUrlView
      state={state}
      origin={origin}
      copied={copied}
      onCreate={submit}
      onAskRegenerate={() => dispatch({ type: "askRegenerate" })}
      onCancelRegenerate={() => dispatch({ type: "cancelRegenerate" })}
      onConfirmRegenerate={submit}
      onCopy={copy}
      onRetry={load}
    />
  );
}

// ---------------------------------------------------------------------------
// View (pure, exported for the tests)
// ---------------------------------------------------------------------------

const BTN_PRIMARY =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] px-4 py-2 text-xs font-semibold text-white shadow-sm ring-1 ring-[var(--color-cyan)] disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50";

export type AgentUrlViewProps = {
  state: AgentUrlState;
  origin: string;
  copied: boolean;
  onCreate: () => void;
  onAskRegenerate: () => void;
  onCancelRegenerate: () => void;
  onConfirmRegenerate: () => void;
  onCopy: (url: string) => void;
  onRetry: () => void;
};

export function AgentUrlView({
  state,
  origin,
  copied,
  onCreate,
  onAskRegenerate,
  onCancelRegenerate,
  onConfirmRegenerate,
  onCopy,
  onRetry,
}: AgentUrlViewProps) {
  const t = useTranslations("AgentUrl");
  const format = useFormatter();
  const { phase, status, revealed, confirming, busy, error } = state;

  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const regenerateRef = useRef<HTMLButtonElement | null>(null);
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const prev = useRef({ confirming, revealed });

  // Focus management: into the confirm when it opens; onto Copy when a new
  // URL is revealed; back to Regenerate when the confirm closes otherwise
  // (Cancel, Escape, or a failed POST).
  useEffect(() => {
    const was = prev.current;
    if (confirming && !was.confirming) cancelRef.current?.focus();
    else if (revealed && revealed !== was.revealed) copyRef.current?.focus();
    else if (!confirming && was.confirming) regenerateRef.current?.focus();
    prev.current = { confirming, revealed };
  }, [confirming, revealed]);

  const onConfirmKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancelRegenerate();
    }
  };

  const url = revealed ? agentUrlFor(origin, revealed) : "";
  const since = status.createdAt ? format.dateTime(new Date(status.createdAt), { dateStyle: "medium" }) : null;

  return (
    <div className="mt-4 space-y-4">
      {phase === "loading" && (
        <p role="status" className="rounded-xl bg-[var(--color-muted)] px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          {t("loading")}
        </p>
      )}

      {phase === "loadError" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p role="alert" className="text-sm text-red-700">
            {t("errorLoad")}
          </p>
          <button type="button" onClick={onRetry} className={BTN_SECONDARY}>
            {t("retry")}
          </button>
        </div>
      )}

      {phase === "ready" && !status.exists && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-muted)] px-4 py-3 text-sm">
          <p className="min-w-0 flex-1 basis-56 text-[var(--color-muted-foreground)]">{t("emptyText")}</p>
          <button type="button" onClick={onCreate} disabled={busy} className={BTN_PRIMARY}>
            {t("create")}
          </button>
        </div>
      )}

      {phase === "ready" && status.exists && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-muted)] px-4 py-3 text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            {status.hint && (
              <span dir="ltr" className="font-mono text-[var(--color-foreground)]">
                {status.hint}
              </span>
            )}
            {since && (
              <span className="text-xs text-[var(--color-muted-foreground)]">{t("activeSince", { date: since })}</span>
            )}
          </div>
          {!confirming && (
            <button ref={regenerateRef} type="button" onClick={onAskRegenerate} disabled={busy} className={BTN_SECONDARY}>
              {t("rotate")}
            </button>
          )}
        </div>
      )}

      {phase === "ready" && status.exists && confirming && (
        <div
          role="group"
          aria-labelledby="agent-url-confirm-title"
          aria-describedby="agent-url-confirm-body"
          onKeyDown={onConfirmKeyDown}
          className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
        >
          <p id="agent-url-confirm-title" className="text-sm font-semibold text-red-800">
            {t("confirmTitle")}
          </p>
          <p id="agent-url-confirm-body" className="text-xs text-red-800">
            {t("confirmBody")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button ref={cancelRef} type="button" onClick={onCancelRegenerate} disabled={busy} className={BTN_SECONDARY}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirmRegenerate}
              disabled={busy}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
            >
              {t("confirmYes")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error === "create" ? t("errorCreate") : t("errorRegenerate")}
        </p>
      )}

      {/* The URL, shown only once: right after the POST. */}
      {revealed && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-[var(--color-foreground)]">{t("urlLabel")}</p>
          <p className="text-xs font-medium text-amber-800">{t("onceWarning")}</p>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              data-agent-url-once=""
              className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-start font-mono text-xs text-[var(--color-foreground)] ring-1 ring-inset ring-amber-200"
            >
              {url}
            </code>
            <button
              ref={copyRef}
              type="button"
              onClick={() => onCopy(url)}
              className="min-h-11 shrink-0 rounded-lg bg-[var(--color-foreground)] px-3 py-2 text-xs font-medium text-white"
            >
              {copied ? t("copied") : t("copy")}
            </button>
            {/* Announces the copy to screen readers (the label swap alone isn't). */}
            <span role="status" aria-live="polite" className="sr-only">
              {copied ? t("copied") : ""}
            </span>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("urlHint")}</p>
        </div>
      )}

      <p className="text-[11px] text-[var(--color-muted-foreground)]">{t("warning")}</p>

      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-xs">
        <p className="font-medium text-[var(--color-foreground)]">{t("contractTitle")}</p>
        {/* Always the placeholder: the token appears in one place only. */}
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 text-start font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]"
        >
{`POST ${t("urlPlaceholder")}
{ "call_id": "…", "turn_id": 1, "language": "fr",
  "transcript": "Bonjour…", "history": [] }

→ 200 { "reply": "…" }   ${t("replyWithin")}`}
        </pre>
      </div>
    </div>
  );
}
