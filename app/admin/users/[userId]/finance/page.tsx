import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import FinanceDashboard from "@/app/admin/finance/FinanceDashboard";

export const dynamic = "force-dynamic";

// Vue Finance scopée sur un seul tenant — réutilise FinanceDashboard avec
// la prop userId (qui passe &userId= à /api/admin/finance-stats et masque la
// table multi-tenant). Layout / header / nav fournis par
// /admin/users/[userId]/layout.tsx.
export default async function AdminTenantFinancePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Projection explicite { role } : évite le SELECT * (toutes colonnes) qui
  // casse tant que la migration d'abonnement n'est pas appliquée.
  const [me] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (me?.role !== "admin") redirect("/dashboard");

  const { userId } = await params;
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) redirect("/admin");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-6">
      <FinanceDashboard userId={target.id} />
    </main>
  );
}
