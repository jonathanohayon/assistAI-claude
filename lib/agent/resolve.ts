// Resolution by call origin (A1) — SERVER-ONLY. Which agent and which
// account settings answer a call. It REUSES today's lookups exactly
// (resolveTenantByUserId / ByPhone, decideTenantResolution, the campaign and
// outbound-agent queries), so it can never resolve differently from the
// routes — including the refusals:
//   - phone with no phone_numbers row → 404 unknown_number (never another tenant);
//   - web/call_me userId with no match → the default tenant (today's fallback);
//   - campaign: 400 missing_params / 404 campaign_not_found / contact_not_found;
//   - outbound test: 400 missing_params / 404 agent_not_found.
// Nothing reads it yet.

import { eq } from "drizzle-orm";

import { accountFrom, agentFromOutbound, agentFromReceptionist } from "@/lib/agent/adapters";
import type { CallOrigin, Resolution } from "@/lib/agent/contract";
import { db } from "@/lib/db";
import { agentConfigs, campaignContacts, campaigns, outboundAgents, users } from "@/lib/db/schema";
import { resolveDefaultTenant, resolveTenantByPhone, resolveTenantByUserId } from "@/lib/tenant";
import { reportTenantFallback } from "@/lib/tenant-fallback";
import { resolveInboundTenantWith } from "@/lib/tenant-resolution";

async function accountRows(accountId: string) {
  // leftJoin: the outbound routes never needed the account's agent_configs
  // row, so its absence must not make resolution fail where they serve.
  const [row] = await db
    .select({ user: users, config: agentConfigs })
    .from(users)
    .leftJoin(agentConfigs, eq(agentConfigs.userId, users.id))
    .where(eq(users.id, accountId))
    .limit(1);
  return row ?? null;
}

export async function resolveCall(
  origin: CallOrigin,
  /** reportFallback: false when the legacy handler already reported a fallback. */
  opts: { reportFallback?: boolean } = {},
): Promise<Resolution> {
  switch (origin.kind) {
    case "vox":
      return { ok: false, external: true };

    case "phone":
    case "web":
    case "call_me": {
      // Same order as /api/agent/config: userId first, else the called number.
      const userId = origin.kind === "phone" ? null : origin.userId || null;
      const phone = origin.kind === "phone" ? origin.calledNumber || null : null;
      const { resolution, tenant } = await resolveInboundTenantWith(
        { origin: origin.kind, phone, userId },
        {
          byUserId: resolveTenantByUserId,
          byPhone: resolveTenantByPhone,
          byDefault: resolveDefaultTenant,
          accountId: (t) => t.user.id,
          // Off when the caller already ran the legacy handler (it reported).
          onFallback: opts.reportFallback === false ? () => {} : reportTenantFallback,
        },
      );
      if (resolution === "unknown_number") return { ok: false, status: 404, error: "unknown_number" };
      if (!tenant) return { ok: false, status: 404, error: "No tenant" };
      return {
        ok: true,
        resolved: {
          agent: agentFromReceptionist(tenant.config),
          account: accountFrom(tenant.user, tenant.config),
          call: { origin, contact: null, campaign: null },
        },
      };
    }

    case "campaign": {
      if (!origin.campaignId || !origin.contactId) return { ok: false, status: 400, error: "missing_params" };
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, origin.campaignId)).limit(1);
      if (!campaign) return { ok: false, status: 404, error: "campaign_not_found" };
      const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, origin.contactId)).limit(1);
      if (!contact) return { ok: false, status: 404, error: "contact_not_found" };
      const agentRow = campaign.agentId
        ? ((await db.select().from(outboundAgents).where(eq(outboundAgents.id, campaign.agentId)).limit(1))[0] ?? null)
        : null;
      const acct = await accountRows(campaign.userId);
      if (!acct) return { ok: false, status: 404, error: "account_not_found" };
      return {
        ok: true,
        resolved: {
          agent: agentFromOutbound(agentRow, campaign.userId),
          account: accountFrom(acct.user, acct.config ?? null),
          call: {
            origin,
            contact: {
              id: contact.id,
              name: contact.contactName ?? "",
              phone: contact.phoneNumber,
              vars: (contact.vars ?? {}) as Record<string, string>,
            },
            campaign: {
              id: campaign.id,
              goalPreset: campaign.goalPreset,
              objective: campaign.objective,
              successCriteria: campaign.successCriteria,
            },
          },
        },
      };
    }

    case "outbound_test": {
      if (!origin.agentId) return { ok: false, status: 400, error: "missing_params" };
      const [agentRow] = await db.select().from(outboundAgents).where(eq(outboundAgents.id, origin.agentId)).limit(1);
      if (!agentRow) return { ok: false, status: 404, error: "agent_not_found" };
      const acct = await accountRows(agentRow.userId);
      if (!acct) return { ok: false, status: 404, error: "account_not_found" };
      return {
        ok: true,
        resolved: {
          agent: agentFromOutbound(agentRow, agentRow.userId),
          account: accountFrom(acct.user, acct.config ?? null),
          call: { origin, contact: null, campaign: null },
        },
      };
    }
  }
}
