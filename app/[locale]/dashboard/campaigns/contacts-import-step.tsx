"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { validateContacts, type RawContact } from "@/lib/campaigns/validate";

import { Chip, Field, inputCls } from "./_ui";

type Tab = "paste" | "file" | "sheets";
type ColRole = "ignore" | "phone" | "name" | "var";
type Parsed = { headers: string[]; rows: string[][] };

// Parse une textarea : une ligne = "numéro" ou "numéro, nom".
function parsePasted(text: string): RawContact[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [phone, ...rest] = line.split(",");
      return {
        phoneNumber: (phone ?? "").trim(),
        contactName: rest.join(",").trim(),
      };
    });
}

// Devine le rôle initial de chaque colonne à partir des en-têtes.
function autoRoles(headers: string[]): ColRole[] {
  let phoneSet = false;
  let nameSet = false;
  return headers.map((h) => {
    const hl = h.toLowerCase();
    if (!phoneSet && /phone|tel|mobile|numéro|number|טלפון/.test(hl)) {
      phoneSet = true;
      return "phone";
    }
    if (!nameSet && /name|nom|שם|contact/.test(hl)) {
      nameSet = true;
      return "name";
    }
    return "ignore";
  });
}

// Si aucune colonne n'a été détectée comme téléphone, prend la 1ère dont les
// valeurs ressemblent à des numéros.
function ensurePhone(roles: ColRole[], rows: string[][]): ColRole[] {
  if (roles.includes("phone")) return roles;
  const next = [...roles];
  for (let i = 0; i < next.length; i++) {
    const looksPhone = rows
      .slice(0, 10)
      .some((r) => /^[+0-9][\d\s\-.()/]{6,}$/.test((r[i] ?? "").trim()));
    if (looksPhone) {
      next[i] = "phone";
      break;
    }
  }
  return next;
}

function buildContacts(parsed: Parsed, roles: ColRole[]): RawContact[] {
  const phoneIdx = roles.indexOf("phone");
  if (phoneIdx < 0) return [];
  const nameIdx = roles.indexOf("name");
  return parsed.rows.map((row) => {
    const vars: Record<string, string> = {};
    roles.forEach((role, i) => {
      if (role === "var" && (row[i] ?? "").trim())
        vars[parsed.headers[i]] = row[i].trim();
    });
    return {
      phoneNumber: (row[phoneIdx] ?? "").trim(),
      contactName: nameIdx >= 0 ? (row[nameIdx] ?? "").trim() : "",
      vars,
    };
  });
}

export function ContactsImportStep({
  campaignId,
  asUserId,
  onAdded,
}: {
  campaignId: string;
  asUserId?: string;
  onAdded: (inserted: number) => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [tab, setTab] = useState<Tab>("paste");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [roles, setRoles] = useState<ColRole[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetRange, setSheetRange] = useState("A:Z");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    duplicates: number;
    rejected: number;
  } | null>(null);

  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";

  // Contacts candidats selon le mode actif.
  const candidates = useMemo<RawContact[]>(() => {
    if (tab === "paste") return parsePasted(raw);
    if (parsed) return buildContacts(parsed, roles);
    return [];
  }, [tab, raw, parsed, roles]);

  const { accepted, rejected } = useMemo(
    () => validateContacts(candidates),
    [candidates],
  );

  const applyParsed = (p: Parsed) => {
    setParsed(p);
    setRoles(ensurePhone(autoRoles(p.headers), p.rows));
    setResult(null);
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setParseError(null);
    setParsed(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/dashboard/campaigns/${campaignId}/import${qs}`,
        { method: "POST", body: fd },
      );
      if (!res.ok) throw new Error("parse");
      const data = (await res.json()) as Parsed;
      if (!data.headers?.length) throw new Error("empty");
      applyParsed(data);
    } catch {
      setParseError(t("createError"));
    } finally {
      setParsing(false);
    }
  };

  const loadSheet = async () => {
    if (!sheetUrl.trim() || parsing) return;
    setParsing(true);
    setParseError(null);
    setParsed(null);
    try {
      const res = await fetch(
        `/api/dashboard/campaigns/${campaignId}/import${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "sheets",
            spreadsheetId: sheetUrl.trim(),
            range: sheetRange.trim(),
          }),
        },
      );
      if (res.status === 409) {
        setParseError(t("sheetsNotConnected"));
        return;
      }
      if (!res.ok) throw new Error("parse");
      const data = (await res.json()) as Parsed;
      if (!data.headers?.length) throw new Error("empty");
      applyParsed(data);
    } catch {
      setParseError(t("createError"));
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!accepted.length || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/dashboard/campaigns/${campaignId}/contacts${qs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contacts: accepted }),
        },
      );
      const data = (await res.json()) as {
        inserted?: number;
        duplicates?: number;
        rejected?: unknown[];
      };
      const inserted = data.inserted ?? 0;
      setResult({
        inserted,
        duplicates: data.duplicates ?? 0,
        rejected: Array.isArray(data.rejected) ? data.rejected.length : 0,
      });
      if (inserted > 0) {
        setRaw("");
        setParsed(null);
        onAdded(inserted);
      }
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  const setRole = (i: number, role: ColRole) => {
    setRoles((prev) =>
      prev.map((rr, idx) => {
        // phone et name sont uniques : on libère l'ancienne colonne.
        if ((role === "phone" || role === "name") && rr === role && idx !== i)
          return "ignore";
        return idx === i ? role : rr;
      }),
    );
  };

  return (
    <div>
      <div className="mb-3">
        <h4 className="text-[14px] font-bold text-[#18181b]">
          {t("contactsTitle")}
        </h4>
        <p className="text-[12px] text-[#64748b]">{t("contactsSubtitle")}</p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Chip active={tab === "paste"} onClick={() => setTab("paste")}>
          {t("tabPaste")}
        </Chip>
        <Chip active={tab === "file"} onClick={() => setTab("file")}>
          {t("tabFile")}
        </Chip>
        <Chip active={tab === "sheets"} onClick={() => setTab("sheets")}>
          {t("tabSheets")}
        </Chip>
      </div>

      {tab === "paste" && (
        <Field label={t("pasteLabel")} hint={t("pasteHint")}>
          <textarea
            className={`${inputCls} min-h-[140px] resize-y font-mono text-[12px]`}
            value={raw}
            placeholder={t("pastePlaceholder")}
            onChange={(e) => setRaw(e.target.value)}
          />
        </Field>
      )}

      {tab === "file" && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragOver
                ? "border-[#ea580c] bg-[#ffedd5] ring-2 ring-[#fdba74]"
                : "border-[#fdba74] bg-[#fff7ed] hover:bg-[#ffedd5]"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-[#ea580c]">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span className="text-[13px] font-semibold text-[#9a3412]">
              {parsing ? t("fileParsing") : t("fileDrop")}
            </span>
          </div>
        </div>
      )}

      {tab === "sheets" && (
        <div className="space-y-3">
          <Field label={t("sheetsUrlLabel")} hint={t("sheetsNotConnected")}>
            <input
              className={inputCls}
              value={sheetUrl}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={(e) => setSheetUrl(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <div className="w-32">
              <Field label={t("sheetsRangeLabel")}>
                <input
                  className={inputCls}
                  value={sheetRange}
                  onChange={(e) => setSheetRange(e.target.value)}
                />
              </Field>
            </div>
            <button
              type="button"
              onClick={loadSheet}
              disabled={parsing || !sheetUrl.trim()}
              className="rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {parsing ? t("fileParsing") : t("sheetsLoad")}
            </button>
          </div>
        </div>
      )}

      {parseError && (
        <div className="mt-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-[13px] text-[#b91c1c]">
          {parseError}
        </div>
      )}

      {/* Mapping des colonnes (file/sheets) */}
      {tab !== "paste" && parsed && parsed.headers.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-[13px] font-bold text-[#18181b]">{t("mapTitle")}</p>
          <p className="mb-3 text-[11px] text-[#94a3b8]">{t("mapHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {parsed.headers.map((h, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#334155]">
                  {h}
                  <span className="ml-1 font-normal text-[#94a3b8]">
                    {parsed.rows[0]?.[i] ? `· ${parsed.rows[0][i]}` : ""}
                  </span>
                </span>
                <select
                  className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1 text-[12px] outline-none"
                  value={roles[i] ?? "ignore"}
                  onChange={(e) => setRole(i, e.target.value as ColRole)}
                >
                  <option value="ignore">{t("mapIgnore")}</option>
                  <option value="phone">{t("mapPhone")}</option>
                  <option value="name">{t("mapName")}</option>
                  <option value="var">{t("mapAsVariable")}</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview validée (commun à tous les modes) */}
      {candidates.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
          <div className="mb-2 flex items-center gap-3 text-[12px] font-semibold">
            <span className="inline-flex items-center gap-1.5 text-[#166534]">
              <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
              {t("previewValid", { count: accepted.length })}
            </span>
            {rejected.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[#b91c1c]">
                <span className="h-2 w-2 rounded-full bg-[#dc2626]" />
                {t("previewInvalid", { count: rejected.length })}
              </span>
            )}
          </div>
          <div className="max-h-44 overflow-y-auto">
            <table className="w-full text-[12px]">
              <tbody>
                {accepted.slice(0, 50).map((c) => (
                  <tr key={c.phoneNumber} className="border-t border-[#e2e8f0]/60">
                    <td dir="ltr" className="py-1 font-mono text-[#18181b] ltr:text-left rtl:text-right">{c.phoneNumber}</td>
                    <td className="py-1 text-[#64748b]">{c.contactName}</td>
                    <td className="py-1 text-right">
                      <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#166534]">
                        {t("rowValid")}
                      </span>
                    </td>
                  </tr>
                ))}
                {rejected.slice(0, 20).map((rr, i) => (
                  <tr key={`r${i}`} className="border-t border-[#e2e8f0]/60">
                    <td className="py-1 font-mono text-[#b91c1c]">{rr.phone || "—"}</td>
                    <td className="py-1" />
                    <td className="py-1 text-right">
                      <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[10px] font-bold text-[#b91c1c]">
                        {rr.reason === "duplicate" ? t("rowDuplicate") : t("rowInvalid")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2.5 text-[12px] text-[#166534]">
          {t("resultInserted", { count: result.inserted })}
          {result.duplicates > 0 &&
            ` · ${t("resultDuplicates", { count: result.duplicates })}`}
          {result.rejected > 0 &&
            ` · ${t("resultRejected", { count: result.rejected })}`}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!accepted.length || busy}
        className="mt-4 rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? t("importing") : t("addContactsCta")}
      </button>
    </div>
  );
}
