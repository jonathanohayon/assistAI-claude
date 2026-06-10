import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { LogsView } from "@/app/[locale]/dashboard/logs/logs-view";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export const dynamic = "force-dynamic";

// Admin monitoring du tenant — réutilise LogsView du dashboard avec
// asUserId pour scoper events + call-metrics. Layout / header / nav
// fournis par /admin/users/[userId]/layout.tsx.
export default async function AdminTenantLogsPage({
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
      <LogsView asUserId={target.id} />
    </main>
  );
}
