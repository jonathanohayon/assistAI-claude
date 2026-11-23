// What the Billing page says about renewal, and which renewal controls it
// shows. Pure: the client renders exactly this.
//
// `autoRenew` is the server's answer to "can this account really be charged
// again without the customer?". It comes from the billing server page as a
// plain boolean; this module never reads env or card data.
//
//   autoRenew false: nothing renews by itself, the account stops at paidUntil.
//     An active account reads "Active until {date}. To continue, renew before
//     that date." with ONE "Renew" button (payment flow, current plan and
//     period). No "Renews on", no cancel / resume control, no cancelled banner.
//   autoRenew true: the page as it was before (renews on, cancel / resume).

export type RenewalStatus = "trialing" | "trial_paused" | "active" | "cancelled" | "expired";
export type RenewalPeriod = "monthly" | "annual";

export interface RenewalStats {
  status: RenewalStatus;
  period: RenewalPeriod | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  /** users.auto_renew: the customer's own cancel / resume choice. */
  autoRenew: boolean;
  cancelledAt: string | null;
}

export type DateLineKey =
  | "trialEndsOn"
  | "pausedSince"
  | "expiredOn"
  | "accessUntil"
  | "renewsOn"
  | "activeUntilRenewBefore";

export interface RenewalView {
  /** Status line under the plan name; null = no line. `date` is an ISO string. */
  dateLine: { key: DateLineKey; date: string } | null;
  /** The single "Renew" button next to the status line. */
  renewButton: boolean;
  /** Danger zone control. */
  control: "cancel" | "resume" | null;
  /** "Subscription cancelled, active until…" banner with its resume link. */
  cancelledBanner: boolean;
}

export function renewalView(stats: RenewalStats, autoRenew: boolean): RenewalView {
  const dateLine = ((): RenewalView["dateLine"] => {
    if (stats.status === "trialing")
      return stats.trialEndsAt ? { key: "trialEndsOn", date: stats.trialEndsAt } : null;
    if (stats.status === "trial_paused")
      return stats.trialEndsAt ? { key: "pausedSince", date: stats.trialEndsAt } : null;
    if (!stats.paidUntil) return null;
    if (stats.status === "expired") return { key: "expiredOn", date: stats.paidUntil };
    if (!autoRenew && stats.status === "active")
      return { key: "activeUntilRenewBefore", date: stats.paidUntil };
    if (!autoRenew || !stats.autoRenew || stats.cancelledAt)
      return { key: "accessUntil", date: stats.paidUntil };
    return { key: "renewsOn", date: stats.paidUntil };
  })();

  if (!autoRenew) {
    return {
      dateLine,
      renewButton: stats.status === "active",
      control: null,
      cancelledBanner: false,
    };
  }

  return {
    dateLine,
    renewButton: false,
    control:
      stats.status === "active" || stats.status === "trialing"
        ? stats.autoRenew
          ? "cancel"
          : "resume"
        : null,
    cancelledBanner: !stats.autoRenew && !!stats.cancelledAt && stats.status === "active",
  };
}

/** What "Renew" pays for: the current plan, for the current period. */
export function renewTarget<P extends string>(
  currentPlanKey: P,
  stats: Pick<RenewalStats, "period">,
  fallbackPeriod: RenewalPeriod,
): { plan: P; period: RenewalPeriod } {
  return { plan: currentPlanKey, period: stats.period ?? fallbackPeriod };
}
