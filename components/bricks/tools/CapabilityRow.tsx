"use client";

/**
 * One capability row of the "what the agent can do" screens: its name, one
 * line on what it does, its state in words, an action slot, and its switch.
 * Shared by the Tools brick (the plan capabilities) and the client-agent
 * brick ("Ask your agent"). The state comes from the server
 * (capabilityView); only the switch reflects unsaved intent.
 */

import { useTranslations } from "next-intl";

import { FOCUS, HINT, LABEL } from "@/components/bricks/controls";

import { capabilityWhatKey, type CapabilityView, type ToolsKind } from "./tools-ui";

export function CapabilityRow({
  v,
  checked,
  onToggle,
  action,
  number,
  kind,
}: {
  v: CapabilityView;
  checked: boolean;
  onToggle: (enabled: boolean) => void;
  action: React.ReactNode;
  /** Transfer: the account's number, local format. */
  number: string | null;
  /** Which screen: the description can differ (outbound has no "caller"). */
  kind: ToolsKind;
}) {
  const t = useTranslations("ToolsBrick");
  const labelId = `tools-${v.key}-label`;
  const statusId = `tools-${v.key}-status`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p id={labelId} className={LABEL}>
          {t(`cap.${v.key}.name`)}
        </p>
        <p className={HINT}>{t(capabilityWhatKey(v.key, kind))}</p>
        {/* The state in words first; colour only repeats it. */}
        <p id={statusId} className="mt-1 text-sm" aria-live="polite">
          <StatusWords v={v} number={number} />
        </p>
        {action}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={statusId}
        onClick={() => onToggle(!checked)}
        className={`relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? "bg-[#be185d]" : "bg-[#cbd5e1]"} ${FOCUS}`}
      >
        <span
          aria-hidden
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1"}`}
        />
      </button>
    </li>
  );
}

function StatusWords({ v, number }: { v: CapabilityView; number: string | null }) {
  const t = useTranslations("ToolsBrick");
  if (v.status === "off")
    return (
      <span className="text-[#475569]">
        {t("statusOff")}
      </span>
    );
  if (v.status === "on")
    return (
      <span className="font-semibold text-[#047857]">
        {v.key === "transfer" && number
          ? t.rich("transferOnTo", { number, n: (c) => <bdi dir="ltr">{c}</bdi> })
          : t(`cap.${v.key}.on`)}
      </span>
    );
  return (
    <span className="text-[#92400e]">
      <span className="font-semibold">{t("statusPending")}</span> {t(`missing.${v.missing}`)}
    </span>
  );
}

