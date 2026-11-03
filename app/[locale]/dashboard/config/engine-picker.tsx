"use client";

/**
 * Admin-only voice engine picker for a tenant: two OpenAI models, Gemini Live
 * and Grok Voice (lib/realtime-provider ADMIN_ENGINE_OPTIONS).
 *
 * Never rendered for tenants: the parent only mounts it when `isAdmin`, the
 * public /dashboard-preview renders the tenant view, and the tenant GET
 * strips `realtimeProvider` server-side. Its copy lives in the admin-only
 * "AdminEngine" namespace, which FullMessagesProvider never ships to tenants
 * (it names suppliers).
 *
 * An entry sets `realtimeProvider` (null = OpenAI) and, for the OpenAI
 * entries, `model`. Gemini/Grok leave `model` untouched, so switching back
 * to OpenAI restores it. The tenant's voice stays an OpenAI voice name; on
 * Gemini/Grok the worker maps it to the closest voice of the same gender, so
 * the voice is never reset on switch.
 */

import { useTranslations } from "next-intl";

import {
  ADMIN_ENGINE_OPTIONS,
  REALTIME_PROVIDER_MODEL,
  currentEngineOption,
  effectiveRealtimeProvider,
  type AdminEngineOptionId,
  type RealtimeProvider,
} from "@/lib/realtime-provider";

import { AdminBadge } from "./shared-ui";
import type { FormState, FormUpdater } from "./types";

export function currentProvider(form: FormState): RealtimeProvider {
  return effectiveRealtimeProvider(form.realtimeProvider);
}

const OPTION_KEY: Record<AdminEngineOptionId, string> = {
  "openai-2": "optionOpenai2",
  "openai-2.1": "optionOpenai21",
  gemini: "optionGemini",
  xai: "optionXai",
};

const SELECT_CLASS =
  "w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors focus:border-[#0e7490] focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15";

export function EnginePicker({
  form,
  update,
  catalogModels,
}: {
  form: FormState;
  update: FormUpdater;
  catalogModels: ReadonlyArray<{ id: string; provider: string }>;
}) {
  const t = useTranslations("AdminEngine");
  const provider = currentProvider(form);
  const selected = currentEngineOption({ realtimeProvider: form.realtimeProvider, model: form.model });
  const hebrew = form.primaryLanguage === "he";

  const onPick = (id: string) => {
    const opt = ADMIN_ENGINE_OPTIONS.find((o) => o.id === id);
    if (!opt) return;
    update("realtimeProvider", opt.realtimeProvider);
    if (opt.model) update("model", opt.model);
  };

  return (
    <div className="flex flex-col gap-4">
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
          value={selected}
          onChange={(e) => onPick(e.target.value)}
          aria-describedby="engine-picker-hint"
          className={SELECT_CLASS}
        >
          {ADMIN_ENGINE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {t.has(OPTION_KEY[o.id]) ? t(OPTION_KEY[o.id]) : o.label}
            </option>
          ))}
          {selected === "custom" && (
            <option value="custom" disabled>
              {t("optionCustom", { model: form.model })}
            </option>
          )}
        </select>

        <div id="engine-picker-hint" className="mt-1.5 space-y-1 text-[11px] leading-snug">
          {provider === "gemini" && <p className="text-[#92400e]">{t("geminiHint")}</p>}
          {provider === "xai" && (
            <p
              className={hebrew ? "font-semibold text-[#b91c1c]" : "text-[#92400e]"}
              role={hebrew ? "alert" : undefined}
            >
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

      {/* Cross-model testing on OpenAI: any catalog model. Picking one that
       *  isn't a picker entry shows the picker as "Custom: <model>". */}
      {provider === "openai" && (
        <div>
          <label
            htmlFor="engine-advanced-model"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#64748b]"
          >
            {t("advancedModel")}
          </label>
          <select
            id="engine-advanced-model"
            value={form.model}
            onChange={(e) => update("model", e.target.value)}
            className={SELECT_CLASS}
          >
            {!catalogModels.some((m) => m.id === form.model) && (
              <option value={form.model}>{form.model}</option>
            )}
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-[#64748b]">{t("advancedModelHint")}</p>
        </div>
      )}
    </div>
  );
}
