"use client";

/**
 * Ventes, not owned (F2): the REAL campaigns workspace, read-only, fed by the
 * sample source (three fictional campaigns, their contacts and results).
 * Opening a campaign, its steps and its results work; nothing is created,
 * saved, imported, launched or deleted, and no request leaves the page.
 */

import { useLocale } from "next-intl";

import { CampaignsWorkspace } from "@/app/[locale]/dashboard/campaigns/campaigns-workspace";

import { PreviewFrame } from "./PreviewFrame";
import { PreviewProvider } from "./preview-context";

const noop = () => {};

export function SalesPreview() {
  const locale = useLocale();
  return (
    <PreviewFrame>
      <PreviewProvider lang={locale}>
        <div className="-mx-4 sm:-mx-6">
          <CampaignsWorkspace open variant="page" onClose={noop} />
        </div>
      </PreviewProvider>
    </PreviewFrame>
  );
}
