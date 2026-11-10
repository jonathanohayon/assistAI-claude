"use client";

/**
 * Tools brick (T2): ONE "what the agent can do" screen, the same module for
 * the receptionist and the outbound agents.
 *
 *   Level 1: each capability the plan includes, in plain words, with a
 *            switch (= `requested`) and its real state in words; a missing
 *            prerequisite says why, with the action (Connect Google, Add a
 *            number). Capabilities the plan doesn't include are never
 *            switches: one line at the bottom, "Available with the … plan".
 *   Level 2: none in T2 — each setting ships with the reader that makes
 *            the call use it.
 *   Level 3 (admin only): the technical tool names, sent by the server in
 *            the admin response only, and a link to the plan matrix.
 *
 * The state comes from the server's effectiveCapabilities (the function the
 * call uses); only the switch reflects the customer's unsaved intent.
 * Tenant-safe: no supplier word, no technical tool name in this file.
 */

import { useTranslations } from "next-intl";

import { ConnectGoogleLink } from "@/components/ConnectGoogleLink";
import { FOCUS, HINT, LABEL } from "@/components/bricks/controls";
import { Link } from "@/i18n/navigation";
import type { CapabilityKey, Tools } from "@/lib/tools/contract";

import { capabilityList, capabilityView, type CapabilityView, type ToolsResponse } from "./tools-ui";

const LINK = `inline-flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline ${FOCUS}`;

export interface ToolsBrickProps {
  kind: "inbound" | "outbound";
  /** The server's last answer (GET or PUT /api/dashboard/tools). */
  served: ToolsResponse;
  /** The switches on screen (may be unsaved). */
  tools: Tools;
  onChange: (next: Tools) => void;
  /** Receptionist: open the field where the transfer number is set. */
  onAddNumber?: () => void;
  /** Where to come back after connecting Google. */
  returnTo: string;
  /** Admin acting for a tenant: no OAuth from here (it would connect the admin's account). */
  asUserId?: string | null;
}

export function ToolsBrick({ kind, served, tools, onChange, onAddNumber, returnTo, asUserId }: ToolsBrickProps) {
  const t = useTranslations("ToolsBrick");
  const tPlans = useTranslations("Plans");
  const { switches, notInPlan } = capabilityList(served.capabilities);
  // The switch shows the customer's intent before saving; plan and
  // prerequisites stay the server's.
  const view = (v: CapabilityView): CapabilityView =>
    capabilityView(v.key, { ...served.capabilities[v.key], requested: tools[v.key].enabled });
  const planName = (key: string) => (tPlans.has(`${key}.name`) ? tPlans(`${key}.name`) : key);
  const upgrades = [...new Set(notInPlan.map((k) => served.upgrade[k]).filter((p): p is string => !!p))];

  return (
    <div className="flex flex-col gap-4">
      <p className={HINT}>{kind === "outbound" ? t("introOutbound") : t("intro")}</p>

      <ul className="flex flex-col divide-y divide-[#f1f5f9] rounded-2xl border border-[#e2e8f0] bg-white">
        {switches.map((s) => (
          <CapabilityRow
            key={s.key}
            v={view(s)}
            checked={tools[s.key].enabled}
            onToggle={(enabled) => onChange({ ...tools, [s.key]: { ...tools[s.key], enabled } })}
            action={
              <Action
                v={view(s)}
                onAddNumber={onAddNumber}
                returnTo={returnTo}
                adminForTenant={!!asUserId}
              />
            }
          />
        ))}
      </ul>

      {notInPlan.length > 0 && (
        <p className="text-sm text-[#475569]">
          {t("notInPlan", { list: notInPlan.map((k) => t(`cap.${k}.name`)).join(", ") })}{" "}
          {upgrades.length > 0 && (
            <Link href="/dashboard/billing" className={LINK}>
              {t("availableWith", { plan: upgrades.map(planName).join(" / ") })}
            </Link>
          )}
        </p>
      )}

      {/* ── Level 3: admin only (the server sends `admin` to admins only) ── */}
      {served.admin && (
        <section aria-labelledby="tools-dev-title" className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4">
          <h3 id="tools-dev-title" className="text-sm font-semibold text-[#18181b]">
            {t("devTitle")}
          </h3>
          <dl className="mt-2 flex flex-col gap-2 text-sm">
            {(Object.keys(served.admin.toolNames) as CapabilityKey[]).map((k) => (
              <div key={k}>
                <dt className="text-xs font-semibold text-[#475569]">{t(`cap.${k}.name`)}</dt>
                <dd dir="ltr" className="font-mono text-xs text-[#18181b]">
                  {served.admin!.toolNames[k].join(", ") || "—"}
                </dd>
              </div>
            ))}
          </dl>
          <a href="/admin" className={`mt-2 ${LINK}`}>
            {t("planMatrix")}
          </a>
        </section>
      )}
    </div>
  );
}

function CapabilityRow({
  v,
  checked,
  onToggle,
  action,
}: {
  v: CapabilityView;
  checked: boolean;
  onToggle: (enabled: boolean) => void;
  action: React.ReactNode;
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
        <p className={HINT}>{t(`cap.${v.key}.what`)}</p>
        {/* The state in words first; colour only repeats it. */}
        <p id={statusId} className="mt-1 text-sm" aria-live="polite">
          <StatusWords v={v} />
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

function StatusWords({ v }: { v: CapabilityView }) {
  const t = useTranslations("ToolsBrick");
  if (v.status === "off") return <span className="text-[#475569]">{t("statusOff")}</span>;
  if (v.status === "on") return <span className="font-semibold text-[#047857]">{t(`cap.${v.key}.on`)}</span>;
  return (
    <span className="text-[#92400e]">
      <span className="font-semibold">{t("statusPending")}</span> {t(`missing.${v.missing}`)}
    </span>
  );
}

function Action({
  v,
  onAddNumber,
  returnTo,
  adminForTenant,
}: {
  v: CapabilityView;
  onAddNumber?: () => void;
  returnTo: string;
  adminForTenant: boolean;
}) {
  const t = useTranslations("ToolsBrick");
  if (v.action === "connectGoogle") {
    // An admin acting for a tenant can't connect the tenant's Google account.
    if (adminForTenant) return <p className={HINT}>{t("connectGoogleTenantOnly")}</p>;
    return (
      <ConnectGoogleLink returnTo={returnTo} className={LINK}>
        {t("connectGoogle")}
      </ConnectGoogleLink>
    );
  }
  if (v.action === "addNumber") {
    return onAddNumber ? (
      <button type="button" onClick={onAddNumber} className={LINK}>
        {t("addNumber")}
      </button>
    ) : (
      <Link href="/dashboard?tile=notifs" className={LINK}>
        {t("addNumber")}
      </Link>
    );
  }
  return null;
}
