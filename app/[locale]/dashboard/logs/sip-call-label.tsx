"use client";

import { useTranslations } from "next-intl";
import type React from "react";

import type { SipLabel } from "@/lib/monitoring-label";

/**
 * A SIP call's header in Monitoring: "SIP …1234 → +972 50-000-0000", or
 * "SIP caller → …" when the caller's last 4 digits are unknown. Both numbers
 * sit in <bdi dir="ltr"> so an RTL page never flips them.
 */
export function SipCallLabel({ label }: { label: SipLabel }) {
  const t = useTranslations("DashboardLogs");
  const ltr = (chunks: React.ReactNode) => <bdi dir="ltr">{chunks}</bdi>;
  if (label.last4) {
    return (
      <>
        {t.rich("sipCallFrom", {
          last4: label.last4,
          number: label.to,
          num: ltr,
          to: ltr,
        })}
      </>
    );
  }
  return <>{t.rich("sipCallUnknownCaller", { number: label.to, to: ltr })}</>;
}
