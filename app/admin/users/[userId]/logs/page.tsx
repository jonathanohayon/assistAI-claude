import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { CallsView } from "@/app/[locale]/dashboard/logs/calls-view";
import { DeveloperConsole } from "@/app/[locale]/dashboard/logs/developer-console";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export const dynamic = "force-dynamic";

// Admin view of the tenant's Calls tab: same Calls view and developer
// console as /dashboard/logs, scoped with asUserId (admins always see the
// console). Layout / header / nav come from /admin/users/[userId]/layout.tsx.
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
      <CallsView asUserId={target.id} />
      <DeveloperConsole isAdmin asUserId={target.id} />
    </main>
  );
}
