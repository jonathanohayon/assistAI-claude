import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { IdleWatcher } from "@/components/IdleWatcher";
import { Logo } from "@/components/ui/Logo";
import { buildAgentPromptPreview } from "@/lib/agent-prompt-preview";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers, users } from "@/lib/db/schema";
import { PLANS, type PlanKey } from "@/lib/plans";
import { voicesFor } from "@/lib/realtime";
import {
  getConfigBlocksDirectiveByPlan,
  getGlobalInstructionsByPlan,
  getHangupDirectiveByPlan,
  getPerCallContextTemplateByPlan,
  getPromptBlockOrderByPlan,
  getSpokenPhoneDirectiveByPlan,
  getSpokenTimeDirectiveByPlan,
} from "@/lib/settings";
import { DEFAULT_PROMPT_BLOCK_ORDER } from "@/lib/agent-prompt-defaults";

import { PromptPreview } from "./prompt-preview";
import { AdminTenantConfigForm } from "./tenant-config-form";

export const dynamic = "force-dynamic";

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
  if (!target) {
    return (
      <main className="mx-auto w-full max-w-5xl p-12">
        <Link
          href="/admin"
          className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          ← Admin
        </Link>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Tenant introuvable.
        </div>
      </main>
    );
  }

  const [cfg] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);
  const phones = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.userId, userId));

  async function handleLogout() {
    "use server";
    await signOut({ redirect: false });
    redirect("/");
  }

  const voices = cfg ? voicesFor(cfg.model) : [];

  // Compose la même séquence de blocs de prompt que celle envoyée à
  // l'agent au prochain appel — pratique pour debug / éditer.
  const planKey: PlanKey =
    target.subscriptionPlan && PLANS.some((p) => p.key === target.subscriptionPlan)
      ? (target.subscriptionPlan as PlanKey)
      : PLANS[0].key;
  // Lit les directives système per-plan + admin block par plan + l'ordre
  // des blocs per-plan en parallèle pour la preview. Empty default =
  // constants hardcoded.
  const [
    globalByPlan,
    spokenTimeByPlan,
    spokenPhoneByPlan,
    hangupByPlan,
    perCallContextByPlan,
    configBlocksByPlan,
    blockOrderByPlan,
  ] = cfg
    ? await Promise.all([
        getGlobalInstructionsByPlan(),
        getSpokenTimeDirectiveByPlan(),
        getSpokenPhoneDirectiveByPlan(),
        getHangupDirectiveByPlan(),
        getPerCallContextTemplateByPlan(),
        getConfigBlocksDirectiveByPlan(),
        getPromptBlockOrderByPlan(),
      ])
    : [null, null, null, null, null, null, null];
  const planSpokenTime = spokenTimeByPlan?.[planKey] ?? "";
  const planSpokenPhone = spokenPhoneByPlan?.[planKey] ?? "";
  const planHangup = hangupByPlan?.[planKey] ?? "";
  const planPerCallCtx = perCallContextByPlan?.[planKey] ?? "";
  const planConfigBlocks = configBlocksByPlan?.[planKey] ?? "";
  const planBlockOrder = blockOrderByPlan?.[planKey] ?? [
    ...DEFAULT_PROMPT_BLOCK_ORDER,
  ];
  const promptBlocks =
    cfg && globalByPlan
      ? buildAgentPromptPreview({
          config: cfg,
          globalForPlan: globalByPlan[planKey] ?? "",
          planKey,
          spokenTime: planSpokenTime,
          spokenPhone: planSpokenPhone,
          hangup: planHangup,
          perCallContextTemplate: planPerCallCtx,
          configBlocks: planConfigBlocks,
          blockOrder: planBlockOrder,
        })
      : [];
  const fullPromptConcat = promptBlocks
    .map((b) => `═══ ${b.label} ═══\n\n${b.content}`)
    .join("\n\n");

  // Preview des blocs admin hérités (pour le popup du checkbox).
  // On garde uniquement les blocs admin-managed : spoken_time, spoken_phone,
  // hangup, per_call_context, config_blocks, admin_global. On exclut
  // persona + language qui ne sont jamais hérités (toujours injectés).
  const ADMIN_INHERIT_BLOCKS = new Set([
    "spoken_time",
    "spoken_phone",
    "hangup",
    "per_call_context",
    "config_blocks",
    "admin_global",
  ]);
  const adminInheritablePreview = promptBlocks
    .filter((b) => ADMIN_INHERIT_BLOCKS.has(b.id))
    .map((b) => `═══ ${b.label} ═══\n\n${b.content}`)
    .join("\n\n");
  const planLabel =
    PLANS.find((p) => p.key === planKey)?.name ?? planKey;

  return (
    <main className="min-h-screen">
      <IdleWatcher />
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/60 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--color-border)] sm:block" />
            <Link
              href="/admin"
              className="hidden text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] sm:block"
            >
              ← Admin
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[var(--color-muted-foreground)] sm:inline">
              {me.email}
            </span>
            <form action={handleLogout}>
              <button className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:bg-[var(--color-muted)]">
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Tenant
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          {target.displayName || target.email}
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--color-muted-foreground)]">
          <span>📧 {target.email}</span>
          <span>
            🛡 rôle :{" "}
            <span className="font-medium text-[var(--color-foreground)]">
              {target.role}
            </span>
          </span>
          <span>
            📞 numéros :{" "}
            <span className="font-mono text-xs text-[var(--color-foreground)]">
              {phones.length === 0
                ? "(aucun)"
                : phones.map((p) => p.phoneNumber).join(", ")}
            </span>
          </span>
          <span>
            ⏳ statut : {target.subscriptionStatus}
            {target.trialEndsAt &&
              ` jusqu'au ${new Date(target.trialEndsAt).toLocaleDateString("fr-FR")}`}
          </span>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8 pb-20">
        {cfg ? (
          <>
            <PromptPreview blocks={promptBlocks} fullPrompt={fullPromptConcat} />
            <AdminTenantConfigForm
              userId={target.id}
              initial={{
                instructions: cfg.instructions,
                greetingInstructions: cfg.greetingInstructions,
                model: cfg.model,
                voice: cfg.voice,
                temperature: cfg.temperature,
                speed: cfg.speed,
                maxResponseTokens: cfg.maxResponseTokens,
                ownerWhatsapp: cfg.ownerWhatsapp,
                primaryLanguage: cfg.primaryLanguage ?? "fr",
                inheritAdminGlobals: cfg.inheritAdminGlobals ?? true,
              }}
              initialVoices={voices}
              adminInheritablePreview={adminInheritablePreview}
              planLabel={planLabel}
            />
          </>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            Ce tenant n&apos;a pas encore de config agent.
          </div>
        )}
      </section>
    </main>
  );
}
