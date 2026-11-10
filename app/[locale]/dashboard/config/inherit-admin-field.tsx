"use client";

/**
 * ADMIN ONLY (Knowledge brick, level 3): does this tenant inherit the plan's
 * shared directives? A tenant never sees this, not even read-only; the
 * server refuses a tenant changing it (admin_only). Tenants who turned
 * inheritance off stay off.
 */

import { AdminBadge, RadioCard } from "./shared-ui";
import type { Translator } from "./types";

export function InheritAdminField({
  value,
  onChange,
  inheritedPreview,
  planLabel,
  t,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  inheritedPreview: string;
  planLabel: string;
  t: Translator;
}) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-[#18181b]">
          {planLabel ? t("wowModeTitleWithPlan", { plan: planLabel }) : t("wowModeTitle")}
        </p>
        <AdminBadge size="xs" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <RadioCard active={value} onClick={() => onChange(true)} title={t("inheritAdminLabel")} desc={t("inheritAdminHelp")} />
        <RadioCard active={!value} onClick={() => onChange(false)} title={t("wowModeCustom")} desc={t("wowModeCustomDesc")} />
      </div>
      {value && inheritedPreview && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[#0e7490] hover:underline">{t("wowViewInherited")}</summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#f8fafc] p-3 font-mono text-[11px] leading-relaxed text-[#18181b]">
            {inheritedPreview}
          </pre>
        </details>
      )}
    </div>
  );
}
