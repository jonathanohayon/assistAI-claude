import NextLink from "next/link";
import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";

/**
 * Where the agent help page and its card live, for the account shown:
 *   - the tenant's own dashboard (no asUserId): /[locale]/dashboard/agent/help;
 *   - the admin tenant view (asUserId = the tenant viewed): the admin route
 *     /admin/users/<id>/agent/help (requireAdminPage), so the help page's test
 *     acts on THAT tenant, never on the admin's own account.
 * Client-safe and pure.
 */
export const AGENT_HELP_HREF = "/dashboard/agent/help";

export type AgentHelpLinks = { help: string; card: string; back: string; admin: boolean };

export function agentHelpLinks(asUserId?: string | null): AgentHelpLinks {
  if (!asUserId) return { help: AGENT_HELP_HREF, card: "/dashboard/agent#client-agent", back: "/dashboard/agent", admin: false };
  const base = `/admin/users/${encodeURIComponent(asUserId)}/agent`;
  return { help: `${base}/help`, card: `${base}#client-agent`, back: base, admin: true };
}

/**
 * The help page's two requests (the brick's EXISTING routes): ?asUserId only
 * when given, i.e. only on the admin route (the routes refuse it from a
 * non-admin: resolveTargetUserId → 403).
 */
export function agentHelpRequests(asUserId?: string | null): { load: string; test: string } {
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  return { load: `/api/dashboard/tools${qs}`, test: `/api/dashboard/tools/client-agent/test${qs}` };
}

/** An admin href is not locale-prefixed (the admin is French-only): plain next/link. */
export function HelpLink({ href, admin, className, children, ...rest }: { href: string; admin: boolean; className?: string; children: ReactNode } & Record<`data-${string}`, boolean | string>) {
  return admin ? (
    <NextLink href={href} className={className} {...rest}>
      {children}
    </NextLink>
  ) : (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
