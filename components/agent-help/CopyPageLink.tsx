"use client";

import { useState } from "react";

import { tenantHelpUrl } from "@/components/agent-help/links";

/**
 * "Copier le lien": copies the TENANT-facing URL of the help page
 * (tenantHelpUrl: this origin + /<locale>/dashboard/agent/help), the same in
 * the admin tenant view: never the /admin URL, never an asUserId.
 */
export function CopyPageLink({ locale, label, copiedLabel }: { locale: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        data-copy-page-link
        onClick={() => {
          navigator.clipboard?.writeText(tenantHelpUrl(window.location.origin, locale)).then(
            () => setCopied(true),
            () => {},
          );
        }}
        className="min-h-11 shrink-0 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs font-medium text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
      >
        {copied ? copiedLabel : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </span>
  );
}
