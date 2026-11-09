"use client";

/**
 * Call-transfer number: where the phone agent transfers a caller who asks
 * for a person. Prefix selector + free-form number; a local "05x…" number is
 * converted to E.164 here (the server refuses national formats).
 *
 * Used by: notifs-panel.tsx, right after the owner WhatsApp card.
 */

import { useId, useState } from "react";

import {
  TRANSFER_PREFIXES,
  type TransferPrefix,
  splitTransferE164,
  toTransferE164,
} from "@/lib/transfer-number-input";

import type { FormState, FormUpdater, Translator } from "./types";

export function TransferNumberField({
  form,
  update,
  t,
}: {
  form: FormState;
  update: FormUpdater;
  t: Translator;
}) {
  const id = useId();
  const [initial] = useState(() => splitTransferE164(form.transferNumber ?? ""));
  const [prefix, setPrefix] = useState<TransferPrefix>(initial.prefix);
  const [local, setLocal] = useState(initial.local);

  const parsed = toTransferE164(prefix, local);
  const invalid = !parsed.ok;

  const apply = (nextPrefix: TransferPrefix, nextLocal: string) => {
    setPrefix(nextPrefix);
    setLocal(nextLocal);
    const r = toTransferE164(nextPrefix, nextLocal);
    // Invalid input is sent as typed so the server refuses it (400) rather
    // than the form silently keeping the previous number.
    update("transferNumber", r.ok ? r.value : nextLocal);
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-[#cbd5e1] bg-white p-4">
      <label htmlFor={`${id}-number`} className="text-sm font-semibold text-[#18181b]">
        {t("transferTitle")}
      </label>
      <div className="flex gap-2" dir="ltr">
        <select
          aria-label={t("transferPrefixAria")}
          value={prefix}
          onChange={(e) => apply(e.target.value as TransferPrefix, local)}
          className="rounded-xl border border-[var(--color-border)] bg-white px-2 py-2 text-sm tabular-nums"
        >
          {TRANSFER_PREFIXES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          id={`${id}-number`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={local}
          onChange={(e) => apply(prefix, e.target.value)}
          placeholder={t("transferPlaceholder")}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint ${id}-status`}
          className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm tabular-nums ${
            invalid ? "border-red-400 focus-visible:outline-red-500" : "border-[var(--color-border)]"
          }`}
        />
      </div>
      <p id={`${id}-status`} aria-live="polite" className="text-[11px]">
        {invalid ? (
          <span className="text-red-600">{t("transferInvalid")}</span>
        ) : parsed.value ? (
          <span className="text-[#0e7490]">
            {t("transferNormalized")} <span className="font-mono" dir="ltr">{parsed.value}</span>
          </span>
        ) : (
          <span className="text-[#475569]">{t("transferNone")}</span>
        )}
      </p>
      <p id={`${id}-hint`} className="text-[11px] leading-relaxed text-[#475569]">
        {t("transferHint")}
      </p>
    </div>
  );
}
