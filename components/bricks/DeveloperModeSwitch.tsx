"use client";

/**
 * Shared brick primitive #1: the account-level "developer mode" switch.
 * Lives in account settings; every brick reads the same flag through
 * useDeveloperMode() to show its level-3 fields. A display preference only.
 */

import { useId } from "react";
import { useTranslations } from "next-intl";

import { useDeveloperMode } from "./use-developer-mode";

export function DeveloperModeSwitch({ asUserId }: { asUserId?: string | null }) {
  const t = useTranslations("Bricks");
  const { enabled, on, saving, error, set } = useDeveloperMode(asUserId);
  const labelId = useId();
  const descId = useId();
  const loading = enabled === null;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-semibold text-[var(--color-foreground)]">
          {t("developerModeLabel")}
        </p>
        <p id={descId} className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          {t("developerModeHint")}
        </p>
        {error === "save" && (
          <p role="alert" className="mt-2 text-xs font-semibold text-[#b91c1c]">
            {t("developerModeSaveError")}
          </p>
        )}
      </div>
      {/* 44×44 hit area around the 24 px track. */}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-busy={saving || loading}
        disabled={loading || saving}
        onClick={() => void set(!on)}
        className="group -m-2.5 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full p-2.5 focus:outline-none disabled:cursor-wait"
      >
        <span
          aria-hidden
          className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-[#0e7490] group-focus-visible:ring-offset-2 ${
            on ? "bg-gradient-to-r from-[#be185d] to-[#db2777]" : "bg-[#94a3b8]"
          } ${loading ? "opacity-60" : ""}`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 motion-reduce:transition-none ${
              on ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    </div>
  );
}
