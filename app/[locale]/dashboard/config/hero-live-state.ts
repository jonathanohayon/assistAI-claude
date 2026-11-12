/**
 * What the dashboard hero may claim about the line being up.
 *
 * The only signal the page has is whether the account owns a phone number
 * (a phone_numbers row, read server-side in dashboard/page.tsx). No number
 * means no call can reach the agent, so the hero must not say "online" or
 * "Live". With a number we keep today's wording: it means "a number is
 * routed to your assistant", not a live health check of the worker.
 */
export type HeroLiveState = {
  live: boolean;
  /** DashboardConfig key shown after the eyebrow. */
  eyebrowStatusKey: "heroLive" | "heroToActivate";
  /** DashboardConfig key of the status card badge. */
  badgeKey: "wowLiveLabel" | "wowToActivateLabel";
};

export function heroLiveState(primaryPhone: string | null | undefined): HeroLiveState {
  const live = Boolean(primaryPhone?.trim());
  return live
    ? { live, eyebrowStatusKey: "heroLive", badgeKey: "wowLiveLabel" }
    : { live, eyebrowStatusKey: "heroToActivate", badgeKey: "wowToActivateLabel" };
}
