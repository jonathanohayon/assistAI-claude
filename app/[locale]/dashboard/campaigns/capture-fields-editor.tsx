"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { EXTRACTION_FIELD_TYPES, type ExtractionField } from "@/lib/campaigns/constants";
import {
  MAX_CAPTURE_FIELDS,
  addCaptureField,
  canAddCaptureField,
  captureEditorView,
  removeCaptureField,
} from "@/lib/campaigns/capture-editor";

import { Section, inputCls } from "./_ui";

/**
 * The campaign's "fields to capture" (extraction schema) editor.
 * Rules in lib/campaigns/capture-editor.ts: hidden for tenants while the
 * server's capture switch is off, shown to admins with one "not active yet"
 * line, and adding stops at MAX_CAPTURE_FIELDS (an existing longer schema is
 * kept untouched; removing still works).
 */
export function CaptureFieldsEditor({
  schema,
  onChange,
  captureOn,
  isAdmin,
}: {
  schema: ExtractionField[];
  onChange: (next: ExtractionField[]) => void;
  /** The server's capture switch, as one boolean from the server page. */
  captureOn: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("DashboardCampaigns");
  const tTools = useTranslations("ToolsBrick");
  const capId = useId();
  const view = captureEditorView(captureOn, isAdmin);
  if (view === "hidden") return null;

  const canAdd = canAddCaptureField(schema);
  const update = (i: number, patch: Partial<ExtractionField>) =>
    onChange(schema.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const field = `${inputCls} min-h-11`;

  return (
    <Section
      title={t("extractionTitle")}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 13h6M9 17h4" />
        </svg>
      }
    >
      {/* Admins only, same reading as MissionBrick's "Not active yet" line:
          a tenant can't act on a platform switch, so it never sees this. */}
      {view === "off_admin" && (
        <p data-capture-off className="mb-2 text-sm text-[#92400e]">
          <span className="font-semibold">{tTools("statusPending")}</span> {t("extractionCaptureOff")}
        </p>
      )}
      <p className="mb-2 text-[11px] text-[#94a3b8]">{t("extractionHint")}</p>
      <div className="space-y-2">
        {schema.map((f, i) => (
          <div
            key={i}
            data-capture-field
            className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white p-2"
          >
            <input
              className={`${field} min-w-[110px] flex-1`}
              placeholder={t("extractionKey")}
              aria-label={t("extractionKey")}
              value={f.key}
              onChange={(e) => update(i, { key: e.target.value })}
            />
            <input
              className={`${field} min-w-[110px] flex-1`}
              placeholder={t("extractionLabelField")}
              aria-label={t("extractionLabelField")}
              value={f.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <select
              // inputCls carries w-full, which beats w-auto: drop it so the
              // row stays on one line on desktop and wraps on a phone.
              className={`${field.replace("w-full ", "")} w-auto`}
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as ExtractionField["type"] })}
            >
              {EXTRACTION_FIELD_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`type_${ty}`)}
                </option>
              ))}
            </select>
            {f.type === "enum" && (
              <input
                className={`${field} basis-full`}
                placeholder={t("extractionOptions")}
                aria-label={t("extractionOptions")}
                value={(f.options ?? []).join(", ")}
                onChange={(e) =>
                  update(i, {
                    options: e.target.value
                      .split(",")
                      .map((o) => o.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
            <button
              type="button"
              data-capture-remove
              onClick={() => onChange(removeCaptureField(schema, i))}
              aria-label={t("extractionRemove")}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[#64748b] transition hover:bg-[#fee2e2] hover:text-[#dc2626]"
            >
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        data-capture-add
        onClick={() => onChange(addCaptureField(schema))}
        disabled={!canAdd}
        aria-describedby={canAdd ? undefined : capId}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed border-[#f97316]/50 px-3 py-1.5 text-[12px] font-semibold text-[#c2410c] transition hover:bg-[#fff7ed] disabled:cursor-not-allowed disabled:border-[#cbd5e1] disabled:text-[#64748b] disabled:hover:bg-transparent"
      >
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {t("extractionAddField")}
      </button>
      {!canAdd && (
        <p id={capId} className="mt-1 text-[12px] text-[#475569]">
          {t("extractionMax", { max: MAX_CAPTURE_FIELDS })}
        </p>
      )}
    </Section>
  );
}
