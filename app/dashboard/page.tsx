import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import {
  REALTIME_MODELS,
  voicesFor,
} from "@/lib/realtime";

import { ConfigForm } from "./config-form";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, session.user.id))
    .limit(1);

  if (!config) {
    return (
      <main className="min-h-screen p-8 flex items-center justify-center">
        <p className="text-sm text-zinc-700">
          Aucune config trouvée. Lance le seed (<code>npm run db:seed</code>) pour
          initialiser ta secrétaire.
        </p>
      </main>
    );
  }

  const modelIds = REALTIME_MODELS.map((m) => m.id);
  const voices = voicesFor(config.model);

  async function handleLogout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">
              Configuration de la secrétaire
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {session.user.email} · dernière mise à jour{" "}
              {new Date(config.updatedAt).toLocaleString("fr-FR")}
            </p>
          </div>
          <form action={handleLogout}>
            <button className="text-sm text-zinc-600 hover:text-zinc-900 underline">
              Se déconnecter
            </button>
          </form>
        </header>

        <ConfigForm
          initial={{
            instructions: config.instructions,
            greetingInstructions: config.greetingInstructions,
            model: config.model,
            voice: config.voice,
            temperature: config.temperature,
            speed: config.speed,
            maxResponseTokens: config.maxResponseTokens,
          }}
          modelIds={modelIds}
          initialVoices={voices}
        />
      </div>
    </main>
  );
}
