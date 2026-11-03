"use client";

/**
 * Admin-only voice engine picker (OpenAI / Gemini / Grok) for a tenant.
 *
 * Never rendered for tenants: the parent only mounts it when `isAdmin`, the
 * public /dashboard-preview renders the tenant view, and the tenant GET
 * strips `realtimeProvider` server-side. Absent or null means OpenAI. Its copy
 * lives in the admin-only "AdminEngine" namespace, which FullMessagesProvider
 * never ships to tenants (it names suppliers).
 *
 * The tenant's voice stays an OpenAI voice name; on Gemini/Grok the worker
 * maps it to the closest voice of the same gender. So switching engines never
 * resets the voice, and switching back to OpenAI loses nothing.
 */

import { useTranslations } from "next-intl";

import {
  REALTIME_PROVIDERS,
  REALTIME_PROVIDER_MODEL,
  effectiveRealtimeProvider,
  type RealtimeProvider,
} from "@/lib/realtime-provider";

import { AdminBadge } from "./shared-ui";
import type { FormState, FormUpdater } from "./types";

export function currentProvider(form: FormState): RealtimeProvider {
  return effectiveRealtimeProvider(form.realtimeProvider);
}

export function EnginePicker({ form, update }: { form: FormState; update: FormUpdater }) {
  const t = useTranslations("AdminEngine");
  const provider = currentProvider(form);
  const hebrew = form.primaryLanguage === "he";

  const label: Record<RealtimeProvider, string> = {
    openai: t("openai"),
    gemini: t("gemini"),
    xai: t("xai"),
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <label
          htmlFor="engine-picker"
          className="text-[11px] font-semibold uppercase tracking-wider text-[#0e7490]"
        >
          {t("label")}
        </label>
        <AdminBadge size="xs" />
      </div>
      <select
        id="engine-picker"
        value={provider}
        onChange={(e) => update("realtimeProvider", e.target.value as RealtimeProvider)}
        aria-describedby="engine-picker-hint"
        className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors focus:border-[#0e7490] focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15"
      >
        {REALTIME_PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {label[p]}
          </option>
        ))}
      </select>

      <div id="engine-picker-hint" className="mt-1.5 space-y-1 text-[11px] leading-snug">
        {provider === "gemini" && <p className="text-[#92400e]">{t("geminiHint")}</p>}
        {provider === "xai" && (
          <p className={hebrew ? "font-semibold text-[#b91c1c]" : "text-[#92400e]"} role={hebrew ? "alert" : undefined}>
            {hebrew ? t("xaiHebrewWarning") : t("xaiHint")}
          </p>
        )}
        {provider !== "openai" && (
          <>
            <p className="text-[#475569]">
              {t("modelReadOnly")}{" "}
              <code dir="ltr" className="rounded bg-[#f1f5f9] px-1 py-0.5 text-[#0f172a]">
                {REALTIME_PROVIDER_MODEL[provider]}
              </code>
            </p>
            <p className="text-[#475569]">{t("voiceApprox")}</p>
          </>
        )}
      </div>
    </div>
  );
}
