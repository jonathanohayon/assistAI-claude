import { redirect } from "next/navigation";

import { dashboardTarget, resolveRequestLocale, type SearchParams } from "@/lib/request-locale";

// /dashboard/<rest…> → /<locale>/dashboard/<rest…>, query kept. Unsafe
// segments ("..", encoded slashes…) drop the tail: the target always stays
// under /<locale>/dashboard. Old paths (logs, crm…) are then sent to their new
// homes by the prefixed pages themselves; no path map here.
export default async function LegacyDashboardDeepRedirect(props: {
  params: Promise<{ rest: string[] }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ rest }, sp] = await Promise.all([props.params, props.searchParams]);
  redirect(dashboardTarget(await resolveRequestLocale(), rest, sp));
}
