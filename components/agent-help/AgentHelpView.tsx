import { AgentHelpContent } from "@/components/agent-help/AgentHelpContent";
import { AgentHelpTest } from "@/components/agent-help/AgentHelpTest";

/**
 * The help page as the DASHBOARD shows it (the tenant's /dashboard/agent/help
 * and the admin tenant view): the shared content (AgentHelpContent) plus the
 * test area, which acts on the account shown. The public page renders
 * AgentHelpContent alone (variant="public"), so it never imports the test.
 * `variant="public"` here is kept for the tests: same output as the public
 * route (no test area).
 */
export function AgentHelpView({
  locale,
  variant = "dashboard",
  testOpen = false,
  asUserId = null,
  testLanguage = null,
}: {
  locale: string;
  variant?: "dashboard" | "public";
  testOpen?: boolean;
  asUserId?: string | null;
  testLanguage?: string | null;
}) {
  return (
    <AgentHelpContent
      locale={locale}
      variant={variant}
      asUserId={asUserId}
      testLanguage={testLanguage}
      testArea={variant === "public" ? null : <AgentHelpTest open={testOpen} asUserId={asUserId} />}
    />
  );
}
