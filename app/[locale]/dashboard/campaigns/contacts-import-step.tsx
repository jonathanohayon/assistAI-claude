"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { validateContacts, type RawContact } from "@/lib/campaigns/validate";

import { Chip, Field, inputCls } from "./_ui";

type Tab = "paste" | "file" | "sheets";

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
  const [result, setResult] = useState<{
    inserted: number;
    duplicates: number;
    rejected: number;
  } | null>(null);

  const parsed = useMemo(() => parsePasted(raw), [raw]);
  const { accepted, rejected } = useMemo(
    () => validateContacts(parsed),
    [parsed],
  );

  const submit = async () => {
    if (!accepted.length || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
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
        onAdded(inserted);
      }
    } catch {
      /* noop — l'UI reste en l'état */
    } finally {
      setBusy(false);
    }
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
        <div className="space-y-3">
          <Field label={t("pasteLabel")} hint={t("pasteHint")}>
            <textarea
              className={`${inputCls} min-h-[140px] resize-y font-mono text-[12px]`}
              value={raw}
              placeholder={t("pastePlaceholder")}
              onChange={(e) => setRaw(e.target.value)}
            />
          </Field>

          {parsed.length > 0 && (
            <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
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
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <tbody>
                    {accepted.slice(0, 50).map((c) => (
                      <tr key={c.phoneNumber} className="border-t border-[#e2e8f0]/60">
                        <td className="py-1 font-mono text-[#18181b]">
                          {c.phoneNumber}
                        </td>
                        <td className="py-1 text-[#64748b]">{c.contactName}</td>
                        <td className="py-1 text-right">
                          <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#166534]">
                            {t("rowValid")}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rejected.slice(0, 20).map((r, i) => (
                      <tr key={`r${i}`} className="border-t border-[#e2e8f0]/60">
                        <td className="py-1 font-mono text-[#b91c1c]">{r.phone || "—"}</td>
                        <td className="py-1" />
                        <td className="py-1 text-right">
                          <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[10px] font-bold text-[#b91c1c]">
                            {r.reason === "duplicate" ? t("rowDuplicate") : t("rowInvalid")}
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
            <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2.5 text-[12px] text-[#166534]">
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
            className="rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("importing") : t("addContactsCta")}
          </button>
        </div>
      )}

      {tab === "file" && (
        <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-10 text-center text-[13px] text-[#64748b]">
          {t("fileComingSoon")}
        </div>
      )}

      {tab === "sheets" && (
        <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-10 text-center text-[13px] text-[#64748b]">
          {t("sheetsComingSoon")}
        </div>
      )}
    </div>
  );
}
