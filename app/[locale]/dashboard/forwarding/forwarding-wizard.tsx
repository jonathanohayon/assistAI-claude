"use client";

/**
 * Call-forwarding wizard: the owner forwards the salon's usual number to
 * their Tamara number, then proves it with a test call.
 *   1. Carrier (codes only where the carrier's official page gives them).
 *   2. The code to dial (copy / tap-to-dial) and how to cancel.
 *   3. Test call: POST /api/dashboard/forwarding-test starts a 10-min window,
 *      GET is polled every 2.5 s until the call is detected or the window ends.
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  activationCode,
  cancelCode,
  CARRIER_IDS,
  CARRIERS,
  type CarrierId,
} from "@/lib/forwarding/carriers";
import {
  displayStatus,
  formatCountdown,
  secondsLeft,
  shouldPoll,
  telHref,
  toIsraeliLocal,
  type ForwardingTest,
  type ForwardingTestError,
} from "@/lib/forwarding/test-view";

const POLL_MS = 2500;

export function ForwardingWizard({
  tenantNumber,
  defaultOwnerPhone,
  asUserId,
}: {
  /** The tenant's Tamara number (E.164). Null = no number provisioned yet. */
  tenantNumber: string | null;
  /** Prefill for the owner's mobile (owner WhatsApp). */
  defaultOwnerPhone: string;
  asUserId?: string;
}) {
  const t = useTranslations("DashboardForwarding");
  const locale = useLocale();
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";

  const [carrier, setCarrier] = useState<CarrierId | null>(null);
  const [ownerPhone, setOwnerPhone] = useState(defaultOwnerPhone);
  const [test, setTest] = useState<ForwardingTest | null>(null);
  const [startError, setStartError] = useState<ForwardingTestError | "network" | null>(null);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const now = useMemo(() => new Date(clock), [clock]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  // ─── Test state: load once, then poll while waiting ──────────────────
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`/api/dashboard/forwarding-test${qs}`, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setTest((await res.json()) as ForwardingTest);
    },
    [qs],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal).catch(() => {});
    return () => ctrl.abort();
  }, [load]);

  const polling = shouldPoll(test, now);
  const pollingRef = useRef(polling);
  pollingRef.current = polling;
  useEffect(() => {
    if (!polling) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ctrl = new AbortController();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      load(ctrl.signal)
        .catch(() => {})
        .finally(() => {
          if (pollingRef.current && !ctrl.signal.aborted) timer = setTimeout(tick, POLL_MS);
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !timer) tick();
      else if (document.visibilityState !== "visible" && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    timer = setTimeout(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [polling, load]);

  // 1 s clock for the countdown, only while waiting.
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [polling]);

  const startTest = async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/dashboard/forwarding-test${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ownerPhone.trim() ? { ownerPhone: ownerPhone.trim() } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ForwardingTest> & { error?: ForwardingTestError };
      if (!res.ok) {
        setStartError(data.error ?? "network");
        return;
      }
      setClock(Date.now());
      setTest((prev) => ({
        status: "waiting",
        startedAt: data.startedAt ?? null,
        expiresAt: data.expiresAt ?? null,
        detectedAt: null,
        verifiedAt: prev?.verifiedAt ?? null,
        tenantNumber: data.tenantNumber ?? tenantNumber,
        ownerPhone: data.ownerPhone ?? null,
      }));
    } catch {
      setStartError("network");
    } finally {
      setStarting(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1800);
    } catch {
      /* clipboard blocked: the code stays visible to type by hand */
    }
  };

  if (!tenantNumber) {
    return (
      <Card>
        <p className="text-sm text-[#475569]">{t("noNumber")}</p>
      </Card>
    );
  }

  const c = carrier ? CARRIERS[carrier] : null;
  const code = c ? activationCode(c, tenantNumber) : null;
  const cancel = c ? cancelCode(c) : null;
  const status = test ? displayStatus(test, now) : "idle";
  const verifiedAt = test?.verifiedAt ?? null;

  return (
    <div className="flex flex-col gap-4">
      {verifiedAt && status !== "detected" && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]">
          <CheckIcon className="h-5 w-5 shrink-0" />
          <span>{t("verifiedOn", { date: dateFmt.format(new Date(verifiedAt)) })}</span>
        </div>
      )}

      {/* Step 1: carrier */}
      <Card>
        <StepTitle n={1} title={t("step1Title")} />
        <p className="mt-1 text-[13px] text-[#475569]">{t("step1Body")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("step1Title")}>
          {CARRIER_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={carrier === id}
              onClick={() => setCarrier(id)}
              className={`rounded-xl border-2 px-3 py-2.5 text-start text-[13px] font-semibold transition ${
                carrier === id
                  ? "border-[#db2777] bg-[#fdf2f8] text-[#9d174d]"
                  : "border-[#e2e8f0] bg-white text-[#18181b] hover:border-[#f9a8d4]"
              }`}
            >
              {t(`carrier_${id}`)}
              <span className="block text-[11px] font-normal text-[#64748b]">
                {t(`line_${CARRIERS[id].line}`)}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Step 2: the code */}
      {c && (
        <Card>
          <StepTitle n={2} title={t("step2Title")} />
          {code ? (
            <>
              <p className="mt-1 text-[13px] text-[#475569]">{t("step2Body")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code dir="ltr" className="rounded-xl bg-[#0f172a] px-4 py-3 font-mono text-lg font-semibold tracking-wide text-white">
                  {code}
                </code>
                <button
                  type="button"
                  onClick={() => copy(code)}
                  className="rounded-full border border-[#e2e8f0] bg-white px-3 py-2 text-[12px] font-semibold hover:bg-[#f8fafc]"
                >
                  {copied === code ? t("copied") : t("copy")}
                </button>
                <a
                  href={telHref(code)}
                  className="rounded-full bg-gradient-to-br from-[#db2777] to-[#be185d] px-4 py-2 text-[12px] font-semibold text-white shadow-sm"
                >
                  {t("dialNow")}
                </a>
              </div>
              <p className="mt-2 text-[12px] text-[#64748b]">
                {c.line === "landline" ? t("dialFromLandline") : t("dialFromMobile")}
              </p>
              <p className="mt-1 text-[12px] text-[#64748b]">{t("costNote")}</p>
              {cancel && (
                <p className="mt-3 text-[12px] text-[#475569]">
                  {t("cancelWith")}{" "}
                  <code dir="ltr" className="rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono">
                    {cancel}
                  </code>
                </p>
              )}
              {c.source && (
                <a
                  href={c.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[12px] font-medium text-[#be185d] underline-offset-2 hover:underline"
                >
                  {t("officialSource", { carrier: t(`carrier_${c.id}`) })} ↗
                </a>
              )}
            </>
          ) : (
            <div className="mt-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3 text-[13px] text-[#78350f]">
              <p className="font-semibold">{t("contactCarrierTitle")}</p>
              <p className="mt-1">
                {t("contactCarrierBody")}{" "}
                <span dir="ltr" className="whitespace-nowrap font-mono font-semibold">
                  {toIsraeliLocal(tenantNumber)}
                </span>
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Step 3: test call */}
      {c && (
        <Card>
          <StepTitle n={3} title={t("step3Title")} />
          {status === "detected" ? (
            <div role="status" className="mt-3 flex gap-3 rounded-xl border-2 border-[#16a34a] bg-[#f0fdf4] p-4">
              <CheckIcon className="mt-0.5 h-6 w-6 shrink-0 text-[#16a34a]" />
              <div>
                <p className="text-[15px] font-bold text-[#166534]">{t("detectedTitle")}</p>
                <p className="mt-0.5 text-[13px] text-[#166534]">{t("detectedBody")}</p>
              </div>
            </div>
          ) : status === "waiting" && test ? (
            <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-[#a5f3fc] bg-[#ecfeff] p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-[#0e7490]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#06b6d4] motion-safe:animate-pulse" aria-hidden />
                {t("waitingTitle")}
                <span className="ms-auto font-mono text-[13px] tabular-nums" dir="ltr">
                  {formatCountdown(secondsLeft(test, now))}
                </span>
              </p>
              <p className="mt-2 text-[13px] text-[#155e75]">
                {t.rich("waitingBody", {
                  phone: () => (
                    <span dir="ltr" className="whitespace-nowrap font-mono font-semibold">
                      {test.ownerPhone ? toIsraeliLocal(test.ownerPhone) : ""}
                    </span>
                  ),
                })}
              </p>
              <p className="mt-1 text-[12px] text-[#64748b]">{t("waitingHangUp")}</p>
            </div>
          ) : (
            <>
              {status === "expired" && (
                <div role="alert" className="mt-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] p-3 text-[13px] text-[#991b1b]">
                  <p className="font-semibold">{t("expiredTitle")}</p>
                  <p className="mt-0.5">{t("expiredBody")}</p>
                </div>
              )}
              <p className="mt-2 text-[13px] text-[#475569]">{t("step3Body")}</p>
              <label className="mt-3 block text-[12px] font-semibold text-[#334155]" htmlFor="fwd-owner-phone">
                {t("ownerPhoneLabel")}
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  id="fwd-owner-phone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="050-000-0000"
                  aria-invalid={startError === "invalid_owner_phone" || startError === "no_owner_phone"}
                  aria-describedby="fwd-owner-phone-error"
                  className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm tabular-nums"
                />
                <button
                  type="button"
                  onClick={startTest}
                  disabled={starting}
                  className="rounded-full bg-gradient-to-br from-[#db2777] to-[#be185d] px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {status === "expired" ? t("retryTest") : t("startTest")}
                </button>
              </div>
              <p id="fwd-owner-phone-error" className="mt-1 min-h-[1rem] text-[12px] text-[#dc2626]">
                {startError ? t(`err_${startError}`) : ""}
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">{children}</section>;
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-[#18181b]">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#db2777] to-[#be185d] text-[12px] text-white">
        {n}
      </span>
      {title}
    </h2>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}
