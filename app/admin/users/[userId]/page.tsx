import { and, eq, gte, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ConfigForm, DEFAULT_BUSINESS } from "@/app/[locale]/dashboard/config-form";
import { DEFAULT_PROMPT_BLOCK_ORDER } from "@/lib/agent-prompt-defaults";
import { buildAgentPromptPreview } from "@/lib/agent-prompt-preview";
import { db } from "@/lib/db";
import { agentConfigs, calls, phoneNumbers, users } from "@/lib/db/schema";
import { PLANS, type PlanKey } from "@/lib/plans";
import {
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getHangupDirectiveByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

// Admin tenant view = même ConfigForm que le dashboard utilisateur, mais
// scopé sur le tenant cible via asUserId. Header / nav / bandeau contexte
// sont fournis par /admin/users/[userId]/layout.tsx.
export default async function AdminTenantPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [me] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!me || me.role !== "admin") redirect("/dashboard");

  const { userId } = await params;
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) redirect("/admin");

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);

  if (!config) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-6">
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Ce tenant n&apos;a pas encore de config agent.
        </div>
      </main>
    );
  }

  const planKey: PlanKey =
    target.subscriptionPlan && PLANS.some((p) => p.key === target.subscriptionPlan)
      ? (target.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  const planLabel = PLANS.find((p) => p.key === planKey)?.name ?? planKey;

  const [primaryPhone] = await db
    .select({ phoneNumber: phoneNumbers.phoneNumber })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId))
    .limit(1);

  const lastUpdated = new Date(config.updatedAt).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

  // Stats du tenant cible — mêmes calculs que /dashboard/page.tsx mais
  // scopés sur target.id.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const stats = await (async () => {
    const [todayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startOfToday)));
    const [monthRow] = await db
      .select({
        totalSeconds: sql<number>`coalesce(sum(jsonb_array_length(transcript)) * 6, 0)::int`,
      })
      .from(calls)
      .where(and(eq(calls.userId, userId), gte(calls.createdAt, startOfMonth)));
    const [totalRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
        withSummary: sql<number>`count(*) filter (where length(summary) > 0)::int`,
        rdv: sql<number>`count(*) filter (where summary ~* 'rdv|rendez-vous|appointment|תור')::int`,
        avgBubbles: sql<number>`coalesce(avg(jsonb_array_length(transcript)), 0)::float`,
      })
      .from(calls)
      .where(eq(calls.userId, userId));
    const total = totalRow?.count ?? 0;
    const withSummary = totalRow?.withSummary ?? 0;
    const conversion = total > 0 ? Math.round((withSummary / total) * 100) : 0;
    const avgSeconds = Math.round((totalRow?.avgBubbles ?? 0) * 6);
    const avgMin = Math.floor(avgSeconds / 60);
    const avgSec = avgSeconds % 60;
    const avgDuration =
      avgSeconds === 0
        ? "—"
        : `${avgMin}m${avgSec.toString().padStart(2, "0")}`;
    const monthSeconds = monthRow?.totalSeconds ?? 0;
    return {
      callsToday: todayRow?.count ?? 0,
      conversion,
      avgDuration,
      rdv: totalRow?.rdv ?? 0,
      minutesThisMonth: Math.round(monthSeconds / 60),
    };
  })();

  // Preview des blocs admin hérités + prompt complet (alimente la tuile
  // admin-only "Prompt système").
  const [
    globalByPlan,
    spokenTimeByPlan,
    spokenPhoneByPlan,
    hangupByPlan,
    perCallContextByPlan,
    configBlocksByPlan,
    blockOrderByPlan,
  ] = await Promise.all([
    getGlobalInstructionsByPlan(),
    getSpokenTimeDirectiveByPlan(),
    getSpokenPhoneDirectiveByPlan(),
    getHangupDirectiveByPlan(),
    getPerCallContextTemplateByPlan(),
    getConfigBlocksDirectiveByPlan(),
    getPromptBlockOrderByPlan(),
  ]);
  const promptBlocksPreview = buildAgentPromptPreview({
    config,
    globalForPlan: globalByPlan[planKey] ?? "",
    planKey,
    spokenTime: spokenTimeByPlan[planKey] ?? "",
    spokenPhone: spokenPhoneByPlan[planKey] ?? "",
    hangup: hangupByPlan[planKey] ?? "",
    perCallContextTemplate: perCallContextByPlan[planKey] ?? "",
    configBlocks: configBlocksByPlan[planKey] ?? "",
    blockOrder: blockOrderByPlan[planKey] ?? [...DEFAULT_PROMPT_BLOCK_ORDER],
  });
  const ADMIN_INHERIT_BLOCKS = new Set([
    "spoken_time",
    "spoken_phone",
    "hangup",
    "per_call_context",
    "config_blocks",
    "admin_global",
  ]);
  const adminInheritablePreview = promptBlocksPreview
    .filter((b) => ADMIN_INHERIT_BLOCKS.has(b.id))
    .map((b) => `═══ ${b.label} ═══\n\n${b.content}`)
    .join("\n\n");
  const fullPromptConcat = promptBlocksPreview
    .map((b) => `═══ ${b.label} ═══\n\n${b.content}`)
    .join("\n\n");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-6">
      <ConfigForm
        initial={{
          instructions: config.instructions,
          greetingInstructions: config.greetingInstructions,
          model: config.model,
          voice: config.voice,
          temperature: config.temperature,
          speed: config.speed,
          maxResponseTokens: config.maxResponseTokens,
          ownerWhatsapp: config.ownerWhatsapp,
          primaryLanguage: config.primaryLanguage ?? "fr",
          inheritAdminGlobals: config.inheritAdminGlobals ?? true,
          personality: config.personality ?? {},
          agentName: config.agentName ?? "",
          noiseReductionLevel: config.noiseReductionLevel ?? 8,
          business: (() => {
            const maybe = (config as unknown as { business?: unknown })
              .business;
            if (
              maybe &&
              typeof maybe === "object" &&
              Array.isArray((maybe as { centres?: unknown }).centres)
            ) {
              return maybe as typeof DEFAULT_BUSINESS;
            }
            return DEFAULT_BUSINESS;
          })(),
        }}
        isAdmin={true}
        adminInheritablePreview={adminInheritablePreview}
        planLabel={planLabel}
        primaryPhone={primaryPhone?.phoneNumber ?? null}
        lastUpdatedLabel={lastUpdated}
        stats={stats}
        asUserId={target.id}
        promptBlocks={promptBlocksPreview}
        fullPromptConcat={fullPromptConcat}
      />
    </main>
  );
}
