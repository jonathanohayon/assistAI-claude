"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { CampaignDraft } from "@/lib/campaigns/types";

import { Field, Section, inputCls } from "./_ui";

// Section "Connaissance métier" : l'utilisateur saisit un/des site(s) web,
// on les scrape + distille en une fiche injectée dans le prompt de l'agent
// (il "apprend" le business → vendeur spécialisé).
export function CampaignKnowledge({
  persona,
  setPersona,
}: {
  persona: CampaignDraft["persona"];
  setPersona: (patch: Partial<CampaignDraft["persona"]>) => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [urls, setUrls] = useState((persona.knowledgeSources ?? []).join("\n"));
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const learn = async () => {
    const list = urls
      .split(/\r?\n|[,;]/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!list.length || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/campaigns/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: list, language: persona.language || "fr" }),
      });
      if (!res.ok) {
        setError(t("knowledgeError"));
        return;
      }
      const data = (await res.json()) as {
        knowledge?: string;
        sources?: string[];
      };
      if (!data.knowledge) {
        setError(t("knowledgeError"));
        return;
      }
      setPersona({
        knowledge: data.knowledge,
        knowledgeSources: data.sources ?? list,
      });
    } catch {
      setError(t("knowledgeError"));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Section
      title={t("knowledgeTitle")}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      }
    >
      <p className="mb-2 text-[11px] text-[#94a3b8]">{t("knowledgeHint")}</p>

      <Field label={t("knowledgeUrlsLabel")}>
        <textarea
          className={`${inputCls} min-h-[64px] resize-y font-mono text-[12px]`}
          value={urls}
          placeholder={t("knowledgeUrlsPlaceholder")}
          onChange={(e) => setUrls(e.target.value)}
        />
      </Field>

      <button
        type="button"
        onClick={learn}
        disabled={scanning || !urls.trim()}
        className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#7c3aed] px-4 py-2 text-[13px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>✨</span>
        {scanning ? t("knowledgeScanning") : t("knowledgeScanCta")}
      </button>

      {error && (
        <p className="mt-2 text-[12px] text-[#b91c1c]">{error}</p>
      )}

      {persona.knowledge && (
        <div className="mt-3">
          <Field
            label={t("knowledgeLabel")}
            hint={
              persona.knowledgeSources?.length
                ? t("knowledgeSourcesLabel", {
                    count: persona.knowledgeSources.length,
                  })
                : undefined
            }
          >
            <textarea
              className={`${inputCls} min-h-[160px] resize-y text-[12px]`}
              value={persona.knowledge}
              placeholder={t("knowledgePlaceholder")}
              onChange={(e) => setPersona({ knowledge: e.target.value })}
            />
          </Field>
        </div>
      )}
    </Section>
  );
}
