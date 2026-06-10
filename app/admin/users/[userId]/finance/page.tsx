import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

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
  await requireAdminPage();

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
