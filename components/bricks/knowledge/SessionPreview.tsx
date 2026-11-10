"use client";

/**
 * Knowledge brick, level 3: the full instructions the call receives, as the
 * server builds them for the call (inboundSessionInstructions /
 * outboundSessionInstructions with a mock contact). Saved state only, so the
 * hint says to save to refresh. Admin-only for now (the text includes the
 * plan's shared directives; the endpoint answers 403 to a tenant).
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FOCUS, HINT, LABEL } from "@/components/bricks/controls";

export function SessionPreview({
  asUserId,
  agentId,
  refreshKey,
}: {
  asUserId?: string | null;
  /** Outbound: which saved agent. Absent = the receptionist. */
  agentId?: string;
  /** Changes after each save, so the preview reloads. */
  refreshKey?: string | number | null;
}) {
  const t = useTranslations("KnowledgeBrick");
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; text: string }>({ status: "loading", text: "" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (asUserId) params.set("asUserId", asUserId);
    if (agentId) params.set("agentId", agentId);
    const qs = params.size ? `?${params}` : "";
    fetch(`/api/dashboard/agent-instructions-preview${qs}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { instructions?: string }) => setState({ status: "ok", text: d.instructions ?? "" }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: "error", text: "" });
      });
    return () => ctrl.abort();
  }, [asUserId, agentId, refreshKey, reload]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={LABEL}>{t("previewTitle")}</p>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className={`min-h-11 cursor-pointer rounded-xl border border-[#e2e8f0] bg-white px-3 text-xs font-semibold text-[#18181b] ${FOCUS}`}
        >
          {t("previewReload")}
        </button>
      </div>
      <p className={HINT}>{t("previewHint")}</p>
      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-[#b91c1c]">
          {t("previewError")}
        </p>
      ) : (
        <pre
          dir="auto"
          aria-busy={state.status === "loading"}
          className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[#e2e8f0] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#18181b]"
        >
          {state.status === "loading" ? t("loading") : state.text}
        </pre>
      )}
    </div>
  );
}
