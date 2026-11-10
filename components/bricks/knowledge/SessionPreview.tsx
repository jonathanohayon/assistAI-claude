"use client";

/**
 * Knowledge brick, level 3: what the call receives, from
 * /api/dashboard/agent-instructions-preview. The SERVER decides the scope:
 *   - admin  → the full exact text (inboundSessionInstructions /
 *              outboundSessionInstructions) + the first sentence;
 *   - tenant → only their own parts (first sentence, company sheet, this
 *              agent's instructions) as the agent receives them, titled
 *              "What you control" — never labelled full or exact.
 * Saved state only (the hint says to save to refresh).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FOCUS, HINT, LABEL } from "@/components/bricks/controls";

type Preview =
  | { scope: "full"; instructions: string; greeting: string }
  | { scope: "tenant"; parts: { greeting: string; companySheet: string; instructions: string } };

/** What the server sent, or null if it isn't one of the two shapes. */
export function parsePreview(raw: unknown): Preview | null {
  const r = raw as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (r?.scope === "full") return { scope: "full", instructions: str(r.instructions), greeting: str(r.greeting) };
  if (r?.scope === "tenant" && r.parts && typeof r.parts === "object") {
    const p = r.parts as Record<string, unknown>;
    return { scope: "tenant", parts: { greeting: str(p.greeting), companySheet: str(p.companySheet), instructions: str(p.instructions) } };
  }
  return null;
}

export function SessionPreview({
  asUserId,
  agentId,
  refreshKey,
}: {
  asUserId?: string | null;
  /** Outbound: which saved agent (its test call). Absent = the receptionist. */
  agentId?: string;
  /** Changes after each save, so the preview reloads. */
  refreshKey?: string | number | null;
}) {
  const t = useTranslations("KnowledgeBrick");
  const [state, setState] = useState<{ status: "loading" | "error" } | { status: "ok"; preview: Preview }>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (asUserId) params.set("asUserId", asUserId);
    if (agentId) params.set("agentId", agentId);
    const qs = params.size ? `?${params}` : "";
    fetch(`/api/dashboard/agent-instructions-preview${qs}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: unknown) => {
        // The server decides the scope (full for admins, the tenant's own parts otherwise).
        const preview = parsePreview(d);
        setState(preview ? { status: "ok", preview } : { status: "error" });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [asUserId, agentId, refreshKey, reload]);

  const preview = state.status === "ok" ? state.preview : null;
  const tenant = preview?.scope === "tenant";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={LABEL}>{tenant ? t("controlTitle") : t("previewTitle")}</p>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className={`min-h-11 cursor-pointer rounded-xl border border-[#e2e8f0] bg-white px-3 text-xs font-semibold text-[#18181b] ${FOCUS}`}
        >
          {t("previewReload")}
        </button>
      </div>
      <p className={HINT}>{tenant ? t("controlHint") : t("previewHint")}</p>
      {tenant && <p className={HINT}>{t("controlSaved")}</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-xs font-semibold text-[#b91c1c]">
          {t("previewError")}
        </p>
      )}
      {state.status === "loading" && (
        <p className="mt-2 text-xs text-[#475569]" aria-busy="true">
          {t("loading")}
        </p>
      )}
      {preview?.scope === "full" && (
        <>
          <Part label={t("partGreeting")} text={preview.greeting} empty={t("partEmpty")} />
          <Part label={t("partFull")} text={preview.instructions} empty={t("partEmpty")} tall />
        </>
      )}
      {preview?.scope === "tenant" && (
        <>
          <Part label={t("partGreeting")} text={preview.parts.greeting} empty={t("partEmpty")} />
          <Part label={t("partSheet")} text={preview.parts.companySheet} empty={t("partEmpty")} tall />
          <Part label={t("partInstructions")} text={preview.parts.instructions} empty={t("partEmpty")} />
        </>
      )}
    </div>
  );
}

function Part({ label, text, empty, tall = false }: { label: string; text: string; empty: string; tall?: boolean }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-[#475569]">{label}</p>
      <pre
        dir="auto"
        className={`mt-1 ${tall ? "max-h-96" : "max-h-40"} overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[#e2e8f0] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#18181b]`}
      >
        {text || empty}
      </pre>
    </div>
  );
}
