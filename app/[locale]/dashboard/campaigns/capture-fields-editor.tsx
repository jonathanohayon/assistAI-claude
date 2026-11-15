"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { EXTRACTION_FIELD_TYPES, type ExtractionField } from "@/lib/campaigns/constants";
import {
  MAX_CAPTURE_FIELDS,
  addCaptureField,
  canAddCaptureField,
  captureEditorView,
  captureKeyRenamed,
  removeCaptureField,
  setCaptureLabel,
  unlabeledCaptureRows,
} from "@/lib/campaigns/capture-editor";
import { showLevel3 } from "@/components/bricks/level3";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";

import { Section, inputCls } from "./_ui";

type EditorProps = {
  schema: ExtractionField[];
  onChange: (next: ExtractionField[]) => void;
  /** The server's capture switch, as one boolean from the server page. */
  captureOn: boolean;
  isAdmin: boolean;
  /** Keys of the schema as last loaded or saved: never re-derived. */
  storedKeys?: readonly string[];
  /** The same schema's key + label: a label stored empty never blocks. */
  storedFields?: readonly { key: string; label: string }[];
  /**
   * Bumped by the workspace each time a save is refused for an unlabeled row
   * (0 = none yet): from then on unlabeled rows are marked, and each bump
   * moves focus to the first one.
   */
  saveCheck?: number;
  /**
   * Each row's key as last seen stored (null = a new row). Defaults to the
   * schema's stored keys at mount; tests pass it to render a renamed key.
   */
  initialKeyOrigins?: readonly (string | null)[];
};

/**
 * The campaign's "fields to capture" (extraction schema) editor.
 * Rules in lib/campaigns/capture-editor.ts: hidden for tenants while the
 * server's capture switch is off, shown to admins with one "not active yet"
 * line, and adding stops at MAX_CAPTURE_FIELDS (an existing longer schema is
 * kept untouched; removing still works).
 *
 * A tenant types the label only: the technical key is derived from it and
 * hidden. The key input is level-3 content (developer mode on, or admin),
 * the same gate as AgentUrlCard / ApiKeyCard.
 */
export function CaptureFieldsEditor(props: EditorProps) {
  const dev = useDeveloperMode();
  return <CaptureFieldsEditorGate {...props} developerMode={dev.on} />;
}

/** The editor without the developer-mode store (rendered as-is by the tests). */
export function CaptureFieldsEditorGate({
  schema,
  onChange,
  captureOn,
  isAdmin,
  storedKeys = [],
  storedFields = [],
  saveCheck = 0,
  initialKeyOrigins,
  developerMode,
}: EditorProps & { developerMode: boolean }) {
  const t = useTranslations("DashboardCampaigns");
  const tTools = useTranslations("ToolsBrick");
  const capId = useId();
  const rowsRef = useRef<HTMLDivElement>(null);

  // Each row's key as last seen stored, so the rename warning compares with
  // the row's OWN stored key (removing a row shifts indexes). Re-read when
  // the stored keys change (after a save the new keys are the stored ones).
  const baseline = () => schema.map((f) => (storedKeys.includes(f.key) ? f.key : null));
  const [origins, setOrigins] = useState<readonly (string | null)[]>(() => initialKeyOrigins ?? baseline());
  const storedSig = storedKeys.join("\n");
  const [seenSig, setSeenSig] = useState(storedSig);
  if (storedSig !== seenSig) {
    setSeenSig(storedSig);
    setOrigins(baseline());
  }

  // A refused save: focus the first marked label input (it scrolls there).
  useEffect(() => {
    if (saveCheck > 0) rowsRef.current?.querySelector<HTMLInputElement>('input[data-capture-label][aria-invalid="true"]')?.focus();
  }, [saveCheck]);

  const view = captureEditorView(captureOn, isAdmin);
  if (view === "hidden") return null;

  const invalid = new Set(saveCheck > 0 ? unlabeledCaptureRows(schema, storedFields) : []);
  const add = () => {
    const next = addCaptureField(schema);
    if (next === schema) return;
    setOrigins(schema.map((_, i) => origins[i] ?? null).concat(null));
    onChange(next);
  };
  const remove = (i: number) => {
    setOrigins(origins.filter((_, idx) => idx !== i));
    onChange(removeCaptureField(schema, i));
  };

  const showKey = showLevel3({ isAdmin, developerMode });
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
      {/* "What we capture from each conversation": the capture runs on the
          transcript after the call, the agent is not told to ask yet. The
          agent-centred wording ("what the agent asks/captures") comes back
          once the agent is told to ask (M3b). HE copy: [HE] to confirm. */}
      <p className="mb-2 text-[11px] text-[#94a3b8]">{t("extractionHint")}</p>
      <div ref={rowsRef} className="space-y-2">
        {schema.map((f, i) => {
          const unlabeled = invalid.has(i);
          const renamed = showKey && captureKeyRenamed(origins[i], f.key, storedKeys);
          const errId = `${capId}-label-${i}`;
          const warnId = `${capId}-key-${i}`;
          return (
          <div
            key={i}
            data-capture-field
            data-capture-unlabeled={unlabeled ? "" : undefined}
            className={`flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2 ${
              unlabeled ? "border-[#dc2626] ring-1 ring-[#dc2626]/30" : "border-[#e2e8f0]"
            }`}
          >
            <input
              data-capture-label
              className={`${field} min-w-[110px] flex-1 ${unlabeled ? "!border-[#dc2626]" : ""}`}
              placeholder={t("extractionLabelField")}
              aria-label={t("extractionLabelField")}
              aria-invalid={unlabeled ? true : undefined}
              aria-describedby={unlabeled ? errId : undefined}
              value={f.label}
              onChange={(e) => onChange(setCaptureLabel(schema, i, e.target.value, storedKeys))}
            />
            {showKey && (
              <input
                data-capture-key
                dir="ltr"
                spellCheck={false}
                autoCapitalize="off"
                className={`${field} min-w-[110px] flex-1 font-mono text-[12px]`}
                placeholder={t("extractionKey")}
                aria-label={t("extractionKey")}
                aria-describedby={renamed ? warnId : undefined}
                value={f.key}
                onChange={(e) => update(i, { key: e.target.value })}
              />
            )}
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
              onClick={() => remove(i)}
              aria-label={t("extractionRemove")}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[#64748b] transition hover:bg-[#fee2e2] hover:text-[#dc2626]"
            >
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
              </svg>
            </button>
            {/* The two lines below: HE copy [HE] to confirm. */}
            {unlabeled && (
              <p id={errId} data-capture-unlabeled-line className="basis-full px-1 text-[12px] font-semibold text-[#b91c1c]">
                {t("extractionUnlabeled")}
              </p>
            )}
            {renamed && (
              <p id={warnId} data-capture-renamed className="basis-full px-1 text-[12px] text-[#92400e]">
                {t("extractionKeyRenamed")}
              </p>
            )}
          </div>
          );
        })}
      </div>
      <button
        type="button"
        data-capture-add
        onClick={add}
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
