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
 *
 * Outbound (T4): rendered only when the server says this account's outbound
 * calls may use tools (`outboundTools.visible`), and then only booking and
 * transfer — contacts and orders are not shown at all.
 *
 * "Ask your agent" (T5b): one more row on the receptionist, only when the
 * server says `clientAgentTool.visible` (not in the DOM otherwise): its
 * switch, the agent's address, the mode, a connection test (plain words
 * only) and a WRITE-ONLY signing secret — generated in the browser, shown
 * once until the save, then only "set / not set".
 */

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ConnectGoogleLink } from "@/components/ConnectGoogleLink";
import { ChipGroup, FOCUS, HINT, LABEL } from "@/components/bricks/controls";
import { MoreSettings } from "@/components/bricks/MoreSettings";
import { Link } from "@/i18n/navigation";
import { CLIENT_AGENT_MODES, type CapabilityKey, type ClientAgentMode } from "@/lib/tools/contract";

import {
  capabilityList,
  capabilityView,
  capabilityWhatKey,
  clientAgentRowVisible,
  clientAgentTestBody,
  clientAgentTestWords,
  clientAgentView,
  generateClientAgentSecret,
  inSentence,
  localPhone,
  secretState,
  clientAgentTestNeedsSave,
  shownCapabilities,
  toolsBrickVisible,
  waitingForGoogle,
  type CapabilityView,
  type ClientAgentRefusal,
  type ScreenTools as Tools,
  type TestWords,
  type ToolsKind,
  type ToolsResponse,
} from "./tools-ui";

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
  /** The last save was refused for these capabilities (403 outbound_tools_disabled). */
  refused?: CapabilityKey[] | null;
  /** The last save was refused for "Ask your agent" (403 client_agent_disabled / 400 unsafe_url). */
  clientAgentRefused?: ClientAgentRefusal | null;
}

export function ToolsBrick({
  kind,
  served,
  tools,
  onChange,
  onAddNumber,
  returnTo,
  asUserId,
  refused,
  clientAgentRefused,
}: ToolsBrickProps) {
  const t = useTranslations("ToolsBrick");
  const tPlans = useTranslations("Plans");
  const locale = useLocale();
  // Outbound without the server's go-ahead: nothing at all (the editor hides the tile too).
  if (!toolsBrickVisible(kind, served)) return null;
  const { switches, notInPlan } = capabilityList(served.capabilities, kind);
  const number = served.account.transferNumber ? localPhone(served.account.transferNumber) : null;
  // The switch shows the customer's intent before saving; plan and
  // prerequisites stay the server's.
  const view = (v: CapabilityView): CapabilityView =>
    capabilityView(v.key, { ...served.capabilities[v.key], requested: tools[v.key].enabled });
  const planName = (key: string) => (tPlans.has(`${key}.name`) ? tPlans(`${key}.name`) : key);
  const upgrades = [...new Set(notInPlan.map((k) => served.upgrade[k]).filter((p): p is string => !!p))];

  return (
    <div className="flex flex-col gap-4">
      <p className={HINT}>{kind === "outbound" ? t("introOutbound") : t("intro")}</p>

      {/* ONE Google notice for every capability waiting for it (not a button per row). */}
      {(() => {
        const waiting = waitingForGoogle(switches.map(view));
        if (!waiting.length) return null;
        return (
          <div role="note" className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3">
            <p className="text-sm text-[#78350f]">
              {t("googleNotice", { list: waiting.map((k) => inSentence(t(`cap.${k}.name`), locale)).join(", ") })}
            </p>
            {asUserId ? (
              <p className={HINT}>{t("connectGoogleTenantOnly")}</p>
            ) : (
              <ConnectGoogleLink returnTo={returnTo} className={LINK}>
                {t("connectGoogle")}
              </ConnectGoogleLink>
            )}
          </div>
        );
      })()}

      {/* A refused save, in plain words next to the switches (never the server's code). */}
      {refused && (
        <p role="alert" className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          {refused.length
            ? t("refusedOutbound", { list: refused.map((k) => inSentence(t(`cap.${k}.name`), locale)).join(", ") })
            : t("refusedOutboundAny")}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-[#f1f5f9] rounded-2xl border border-[#e2e8f0] bg-white">
        {switches.map((s) => (
          <CapabilityRow
            key={s.key}
            v={view(s)}
            checked={tools[s.key].enabled}
            onToggle={(enabled) => onChange({ ...tools, [s.key]: { ...tools[s.key], enabled } })}
            number={s.key === "transfer" ? number : null}
            kind={kind}
            action={<Action v={view(s)} hasNumber={!!number} onAddNumber={onAddNumber} />}
          />
        ))}
        {clientAgentRowVisible(kind, served) && (
          <CapabilityRow
            v={clientAgentView(served, tools)}
            checked={tools.clientAgent.enabled}
            onToggle={(enabled) => onChange({ ...tools, clientAgent: { ...tools.clientAgent, enabled } })}
            number={null}
            kind={kind}
            action={<ClientAgentSettings tools={tools} storedUrl={served.tools.clientAgent?.url ?? ""} onChange={onChange} asUserId={asUserId} refused={clientAgentRefused ?? null} />}
          />
        )}
      </ul>

      {notInPlan.length > 0 && (
        <p className="text-sm text-[#475569]">
          {t("notInPlan", { list: notInPlan.map((k) => inSentence(t(`cap.${k}.name`), locale)).join(", ") })}{" "}
          {upgrades.length > 0 && (
            <Link href="/dashboard/billing" className={LINK}>
              {t("availableWith", { plan: upgrades.map(planName).join(" / ") })}
            </Link>
          )}
        </p>
      )}

      {/* ── Level 3: admin only (the server sends `admin` to admins only) ── */}
      {served.admin && (
        <MoreSettings level={3}>
          <dl className="flex flex-col gap-2 text-sm">
            {shownCapabilities(kind).filter((k) => k in served.admin!.toolNames).map((k) => (
              <div key={k}>
                <dt className="text-xs font-semibold text-[#475569]">{t(`cap.${k}.name`)}</dt>
                <dd dir="ltr" className="font-mono text-xs text-[#18181b]">
                  {served.admin!.toolNames[k].join(", ") || "—"}
                </dd>
              </div>
            ))}
          </dl>
          {/* /admin is outside the locale routes. */}
          <NextLink href="/admin" className={`mt-2 ${LINK}`}>
            {t("planMatrix")}
          </NextLink>
        </MoreSettings>
      )}
    </div>
  );
}

function CapabilityRow({
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

function Action({ v, hasNumber, onAddNumber }: { v: CapabilityView; hasNumber: boolean; onAddNumber?: () => void }) {
  const t = useTranslations("ToolsBrick");
  // Google: one notice above the list, no button per row.
  // Transfer: "Edit" next to the number, or "Add a number" when there's none.
  const label = v.action === "addNumber" ? t("addNumber") : v.key === "transfer" && v.status === "on" && hasNumber ? t("editNumber") : null;
  if (!label) return null;
  return onAddNumber ? (
    <button type="button" onClick={onAddNumber} className={LINK}>
      {label}
    </button>
  ) : (
    <Link href="/dashboard?tile=notifs" className={LINK}>
      {label}
    </Link>
  );
}

const BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const ALERT = "rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]";
// "https://" kept left-to-right inside Hebrew sentences.
const ltr = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;

/**
 * "Ask your agent" settings: address, mode, signing secret, connection test.
 * Everything is the screen's unsaved state until the page's Save.
 */
function ClientAgentSettings({
  tools,
  storedUrl,
  onChange,
  asUserId,
  refused,
}: {
  tools: Tools;
  /** The address the server has (to know when a test can't be meaningful yet). */
  storedUrl: string;
  onChange: (next: Tools) => void;
  asUserId?: string | null;
  refused: ClientAgentRefusal | null;
}) {
  const t = useTranslations("ToolsBrick.agent");
  const id = useId();
  const ca = tools.clientAgent;
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  // The new secret stays on screen until the user says it's copied (or leaves
  // the page) — NOT tied to the save: a box that vanished after a partly
  // failed save, before it was copied, would force a regenerate.
  const [revealed, setRevealed] = useState<string | null>(null);
  const testBlocked = clientAgentTestNeedsSave(tools, storedUrl);
  // What the box shows: the secret generated here, else a new one in the draft.
  const shown = revealed ?? (typeof ca.secret === "string" ? ca.secret : null);
  const [test, setTest] = useState<TestWords | "running" | null>(null);
  const secret = secretState(tools);

  const set = (patch: Partial<Tools["clientAgent"]>) => onChange({ ...tools, clientAgent: { ...ca, ...patch } });
  // Back to what the server has: no `secret` key at all (the save omits it).
  const keepStoredSecret = () => {
    const { secret: _drop, ...rest } = ca;
    void _drop;
    onChange({ ...tools, clientAgent: rest });
  };
  const generate = () => {
    setConfirming(false);
    setCopied(false);
    const s = generateClientAgentSecret();
    setRevealed(s);
    set({ secret: s });
  };

  const runTest = async () => {
    const body = clientAgentTestBody(tools);
    // Nothing to test: say so without spending one of the account's tests.
    if (!body.url) return setTest({ key: "no_agent_url" });
    setTest("running");
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    try {
      const res = await fetch(`/api/dashboard/tools/client-agent/test${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setTest(clientAgentTestWords(res.status, await res.json().catch(() => null)));
    } catch {
      setTest({ key: "generic" });
    }
  };

  const urlId = `${id}-url`;
  const urlHintId = `${id}-url-hint`;
  const urlErrorId = `${id}-url-error`;
  const secretLabelId = `${id}-secret`;

  return (
    <div className="mt-3 flex flex-col gap-4">
      {/* A refused save, in our words next to the row (never the server's message). */}
      {refused === "disabled" && (
        <p role="alert" className={ALERT}>
          {t("refused.disabled")}
        </p>
      )}

      <div>
        <label htmlFor={urlId} className={LABEL}>
          {t("url")}
        </label>
        <input
          id={urlId}
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={ca.url}
          aria-describedby={refused === "unsafeUrl" ? `${urlHintId} ${urlErrorId}` : urlHintId}
          aria-invalid={refused === "unsafeUrl" || undefined}
          onChange={(e) => {
            setTest(null);
            set({ url: e.target.value });
          }}
          className={`mt-1 block min-h-11 w-full rounded-xl border bg-white px-3 text-start text-sm text-[#18181b] ${refused === "unsafeUrl" ? "border-[#dc2626]" : "border-[#cbd5e1]"} ${FOCUS}`}
        />
        <p id={urlHintId} className={HINT}>
          {t.rich("urlHint", { l: ltr })}
        </p>
        {refused === "unsafeUrl" && (
          <p id={urlErrorId} role="alert" className={`mt-2 ${ALERT}`}>
            {t.rich("refused.unsafeUrl", { l: ltr })}
          </p>
        )}
      </div>

      <div>
        <ChipGroup
          label={t("mode")}
          options={CLIENT_AGENT_MODES.map((m) => ({ id: m, label: t(`modes.${m}`) }))}
          selected={ca.mode}
          onPick={(m) => set({ mode: m as ClientAgentMode })}
        />
        <p className={`mt-2 ${HINT}`}>{t(`modeHint.${ca.mode}`)}</p>
      </div>

      <div>
        <p id={secretLabelId} className={LABEL}>
          {t("secret")}
        </p>
        <p className={HINT}>{t("secretHint")}</p>
        {/* Only ever "set / not set" from the server: the value never comes back. */}
        <p className="mt-1 text-sm text-[#18181b]" aria-live="polite">
          {secret === "set" ? t("secretSet") : secret === "removing" ? t("secretRemoving") : secret === "unset" ? t("secretUnset") : null}
        </p>

        {shown !== null && (
          <div className="mt-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3" role="group" aria-labelledby={`${id}-new`}>
            <p id={`${id}-new`} className="text-sm font-semibold text-[#78350f]">
              {t("newSecretLabel")}
            </p>
            <code dir="ltr" className="mt-1 block select-all break-all rounded-lg bg-white px-2 py-2 font-mono text-sm text-[#18181b]">
              {shown}
            </code>
            <p className="mt-2 text-sm font-semibold text-[#78350f]">{t("copyNow")}</p>
            {secret === "new" && <p className={HINT}>{t("saveToKeep")}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  navigator.clipboard?.writeText(shown).then(
                    () => setCopied(true),
                    () => {},
                  );
                }}
              >
                {t("copy")}
              </button>
              {/* Before the save: drop it. After: only "C'est copié" closes the box. */}
              {secret === "new" ? (
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setRevealed(null);
                    keepStoredSecret();
                  }}
                >
                  {t("undo")}
                </button>
              ) : (
                <button type="button" className={BUTTON} onClick={() => setRevealed(null)}>
                  {t("copiedDone")}
                </button>
              )}
              <span className="text-sm text-[#047857]" aria-live="polite">
                {copied ? t("copied") : ""}
              </span>
            </div>
          </div>
        )}

        {/* Regenerating breaks the secret the customer's agent uses: ask first. */}
        {shown !== null && secret !== "new" ? null : confirming ? (
          <div role="group" aria-labelledby={`${id}-confirm`} className="mt-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <p id={`${id}-confirm`} role="alert" className="text-sm text-[#18181b]">
              {t("confirmRegenerate")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={BUTTON} onClick={generate}>
                {t("confirmYes")}
              </button>
              <button type="button" className={BUTTON} onClick={() => setConfirming(false)}>
                {t("confirmNo")}
              </button>
            </div>
          </div>
        ) : (
          secret !== "new" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BUTTON}
                aria-describedby={secretLabelId}
                onClick={() => (secret === "set" ? setConfirming(true) : generate())}
              >
                {secret === "set" ? t("regenerate") : t("generate")}
              </button>
              {secret === "set" && (
                <button type="button" className={LINK} aria-describedby={secretLabelId} onClick={() => set({ secret: null })}>
                  {t("remove")}
                </button>
              )}
              {secret === "removing" && (
                <button type="button" className={LINK} onClick={keepStoredSecret}>
                  {t("undo")}
                </button>
              )}
            </div>
          )
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={`${BUTTON} self-start`}
          onClick={runTest}
          disabled={test === "running" || testBlocked}
          aria-describedby={testBlocked ? `${id}-test-save` : undefined}
        >
          {test === "running" ? t("testing") : t("testButton")}
        </button>
        {/* Changed address + kept secret: the test would run unsigned while the live call is signed. */}
        {testBlocked && (
          <p id={`${id}-test-save`} className={HINT}>
            {t("saveFirstToTest")}
          </p>
        )}
        {/* One calm line, in our words only: never an address, a remote body or a status number. */}
        <p role="status" aria-live="polite" className="min-h-5 text-sm">
          {test && test !== "running" && (
            <span className={test.key === "ok" ? "font-semibold text-[#047857]" : "text-[#92400e]"}>
              {test.key === "ok" ? t("test.ok", { ms: test.ms }) : t(`test.${test.key}`)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
