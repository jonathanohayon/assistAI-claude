"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Contact = {
  id: string;
  phoneNumber: string;
  contactName: string;
  status: string;
};

const STATUS_TONE: Record<string, string> = {
  queued: "bg-[#f1f5f9] text-[#475569]",
  claimed: "bg-[#fff7ed] text-[#9a3412]",
  calling: "bg-[#fff7ed] text-[#9a3412]",
  completed: "bg-[#dcfce7] text-[#166534]",
  failed: "bg-[#fee2e2] text-[#b91c1c]",
  no_answer: "bg-[#fee2e2] text-[#b91c1c]",
  voicemail: "bg-[#fef9c3] text-[#854d0e]",
  busy: "bg-[#fef9c3] text-[#854d0e]",
  skipped: "bg-[#f1f5f9] text-[#94a3b8]",
};

// Liste des contacts déjà dans la campagne (numéros ajoutés). Se rafraîchit
// quand `refreshKey` change (après un ajout depuis ContactsImportStep).
export function CampaignContactsList({
  campaignId,
  asUserId,
  refreshKey,
}: {
  campaignId: string;
  asUserId?: string;
  refreshKey: number;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    fetch(`/api/dashboard/campaigns/${campaignId}${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((data: { contacts?: Contact[] }) => {
        if (cancelled) return;
        setContacts(data.contacts ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, asUserId, refreshKey]);

  const statusLabel = (s: string) => {
    if (s === "queued") return t("detailQueued");
    if (s === "claimed" || s === "calling") return t("detailInFlight");
    if (s === "completed") return t("detailConnected");
    return t("detailDone");
  };

  if (!loaded) return null;

  return (
    <div className="mt-5 rounded-2xl border border-[#e2e8f0] bg-white p-4">
      <p className="mb-2 text-[13px] font-bold text-[#18181b]">
        {t("contactsCount", { count: contacts.length })}
      </p>
      {contacts.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-[#94a3b8]">
          {t("listEmptyBody")}
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                <th className="pb-1.5">{t("colPhone")}</th>
                <th className="pb-1.5">{t("colName")}</th>
                <th className="pb-1.5 text-right">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t border-[#f1f5f9]">
                  <td dir="ltr" className="py-1.5 font-mono text-[#18181b] ltr:text-left rtl:text-right">
                    {c.phoneNumber}
                  </td>
                  <td className="py-1.5 text-[#64748b]">{c.contactName || "—"}</td>
                  <td className="py-1.5 text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        STATUS_TONE[c.status] ?? STATUS_TONE.queued
                      }`}
                    >
                      {statusLabel(c.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
