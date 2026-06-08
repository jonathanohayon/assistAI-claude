# Billing dashboard overhaul — Tamara (design)

Date: 2026-06-08

## Context

The current `/dashboard/billing` only shows plan cards + a HYP one-shot payment
modal. There's no usage visibility, no subscription management (cancel, change
card, plan switch with dates), no invoice history, and no graphs. We want a
**pro-grade billing experience** comparable to competitors, on top of the
existing HYP (Yaad `icom.yaad.net`) integration.

Owner decisions (2026-06-08):
- **HYP tokens (J5/HK) are active on the masof** → build tokenized recurring:
  saved card, change card, auto-renew, cancel stops auto-charge.
- **Persist call duration** (new `calls.duration_seconds`) for accurate usage.
- **Graphs wanted:** minutes used vs included, calls/day, spend/payment history,
  channel/outcome breakdown.

### HYP constraints (ground truth from `lib/hyp.ts` + Yaad Pay-Protocol)
- Today: hosted-page one-shot only (`APISign SIGN`/`VERIFY`). No token, no refund.
- Recurring tokens use **`HK=True`** (Hok Keva / standing order) when creating the
  hosted payment; the token + card expiry (`Tokef`) + last4 come back in the
  VERIFY response. A saved token is charged server-to-server later via `action=pay`
  with `Token` + `Tokef` + signature.
- ⚠️ The **exact token-charge field names are not fully confirmed** from public
  docs (apiary flaky). The money path (auto-renew, token charge) is therefore
  **Phase D, gated** behind a live masof test — built but not enabled until
  verified, so we never risk a wrong/double charge.
- No refunds via API → **cancel = keep access until `paidUntil`, then expire**;
  **downgrade = scheduled at period end** (no credit back). These are the
  standard no-refund pro patterns and require no provider features.

## Phasing (de-risks the payment path)

- **Phase A — foundation (no provider risk):** schema migration, duration
  persistence, pure subscription logic + tests, usage/stats API.
- **Phase B — UI + graphs:** recharts, 4 charts, billing redesign, cancel/resume,
  scheduled downgrade, delete-account danger zone, i18n.
- **Phase C — cron:** apply scheduled downgrades + flip expired.
- **Phase D — tokenization (gated):** HYP token issue/charge, saved card, change
  card, auto-renew cron. Enabled only after masof verification.

---

## Schema (`lib/db/schema.ts`) + migration `drizzle/0021_*`

**`users`** — add:
- `subscription_period` text null — `'monthly'|'annual'` of the active sub (for
  renewal amount + UI).
- `auto_renew` boolean not null default true.
- `cancelled_at` timestamptz null — set when user cancels; access until `paidUntil`.
- `scheduled_plan` text null · `scheduled_plan_period` text null ·
  `scheduled_plan_at` timestamptz null — pending downgrade (effective date).
- `hyp_token` text null · `hyp_token_exp` text null (Tokef MMYY) ·
  `card_last4` text null · `card_brand` text null — saved card (Phase D; columns
  added now so the model is stable).

**`calls`** — add:
- `duration_seconds` integer not null default 0.

`payment_orders` already covers invoice/receipt history (planKey, period,
currency, expectedAmount, status, paidAt, hypTransactionId, rawResponse). Add:
- `kind` text not null default `'subscription'` — `'subscription'|'renewal'|'plan_change'`
  (clearer receipts/audit).

Run `npx drizzle-kit generate`; commit the generated SQL + snapshot.

---

## Phase A — foundation

### Duration persistence — `app/api/calls/end/route.ts`
The handler already receives `durationSeconds` in the body (currently only logged
to events/Sheets). Also write it onto the `calls` row update. Backfill not needed
(usage is forward-looking; historical rows count as 0).

### `lib/subscription.ts` (pure, unit-tested)
- `PLAN_RANK: Record<PlanKey, number>` (whatsapp<global<premium, by minutes/price).
- `classifyChange(current, next): 'upgrade'|'downgrade'|'same'`.
- `currentPeriodWindow(user, now): { start: Date; end: Date; kind: 'trial'|'paid'|'expired' }`
  — derives the active billing window from `trialEndsAt` / `paidUntil` /
  `subscription_period` (reuse `addPeriod` from `lib/billing-activation.ts`).
- `effectiveDowngradeDate(user): Date` = `paidUntil` (fallback now).
- Pure date/label helpers. Tests via `tsx` (no DB/network), mirroring
  `billing-activation` test style.

### `GET /api/dashboard/billing-stats` (auth; `asUserId` for admin via the same
`resolveScopeUserId` pattern used elsewhere)
Returns JSON for the dashboard:
- `plan`, `status`, `paidUntil`, `trialEndsAt`, `autoRenew`, `cancelledAt`,
  `scheduledPlan`/`scheduledPlanAt`, `period`, `card` (last4/brand or null).
- `period`: `{ start, end, kind }`.
- `usage`: `{ minutesUsed, minutesIncluded, overageRateIls }` —
  `minutesUsed = (Σ calls.duration_seconds + Σ campaign_calls.duration_seconds in window)/60`.
- `callsPerDay`: `[{ date, inbound, outbound }]` (group by `date(created_at at tz
  'Asia/Jerusalem')`).
- `outcomes`: campaign outcome counts + inbound vs outbound totals (donut).
- `payments`: paid `payment_orders` desc (invoice/receipt list).
All aggregation via Drizzle `sql` filters (patterns already in campaigns route).

---

## Phase B — UI + graphs

### Charts — add **recharts** dep, client wrappers under
`app/[locale]/dashboard/billing/charts/`:
- `MinutesGauge.tsx` — radial progress, minutes used vs included, overage warning.
- `CallsPerDayChart.tsx` — stacked bar (inbound/outbound) over the period.
- `SpendChart.tsx` — bar of paid amounts over time.
- `OutcomeDonut.tsx` — pie of inbound vs outbound (+ campaign outcomes).
Each is a small `"use client"` component fed by `billing-stats`. Styling matches
existing tokens (`var(--color-*)`), entrance animation via `motion` (already used).

### Billing page redesign (`app/[locale]/dashboard/billing/page.tsx` + `client.tsx`)
Sections, top→bottom:
1. **Current plan header** — plan name, status badge (trial/active/cancelled/
   expired), renewal/expiry date, `auto_renew` state. Banner if a scheduled
   downgrade exists ("Passe à X le <date>"). Banner if cancelled ("Actif jusqu'au
   <date>, ne se renouvellera pas" + Reprendre).
2. **Usage** — `MinutesGauge` + `CallsPerDayChart` + `OutcomeDonut`.
3. **Spend & invoices** — `SpendChart` + receipts table (date, plan, period,
   amount, status; download/print receipt from `payment_orders`).
4. **Payment method** — saved card (`•••• last4`) + "Changer la carte" (Phase D).
   Phase A/B fallback copy: card entered securely at each payment.
5. **Plans** — existing `PlanCard` grid, but the CTA reflects upgrade/downgrade:
   - upgrade → "Passer à X maintenant" (charge now via hosted modal, immediate).
   - downgrade → "Programmer X" → confirm dialog showing the effective date →
     `POST /api/dashboard/subscription/schedule-change`.
6. **Danger zone** — Cancel subscription + Delete account (reuse
   `settings/delete-account-section.tsx`, extracted to be embeddable).

### Subscription management API
- `POST /api/dashboard/subscription/cancel` → `cancelled_at=now`, `auto_renew=false`.
  Access stays until `paidUntil`. Log event.
- `POST /api/dashboard/subscription/resume` → if `paidUntil>now`:
  `cancelled_at=null`, `auto_renew=true`.
- `POST /api/dashboard/subscription/schedule-change` body `{ plan, period }` —
  only for downgrades; sets `scheduled_plan`/`scheduled_plan_period`/
  `scheduled_plan_at=paidUntil`. Upgrades go through the existing HYP payment flow
  (immediate). Clearing a scheduled change supported (`plan=null`).
- Remove the old free no-op `setPlan` server action (it silently changed plans
  without payment — a billing hole).

### i18n
Extend `DashboardBilling` namespace in `messages/{fr,he,en}.json` (sections,
statuses, chart labels, cancel/resume/schedule copy, receipts, danger zone).

---

## Phase C — cron (`app/api/cron/billing/route.ts`, INTERNAL_SECRET-gated)
- **Apply scheduled downgrades:** users with `scheduled_plan_at <= now` →
  set `subscription_plan = scheduled_plan`, `subscription_period =
  scheduled_plan_period`, clear scheduled_* . Log + email.
- **Expire:** users `active` with `paidUntil < now` and (`auto_renew=false` OR no
  token) → `subscription_status='expired'`. (Trial expiry stays in trial-cleanup.)
Hook into Railway cron alongside `trial-cleanup`.

---

## Phase D — HYP tokenization (GATED, built not enabled)

### `lib/hyp.ts`
- `createPaymentUrl(..., { issueToken })` → when true add `HK=True` (+ required
  Yaad recurring params). Capture `Token`, `Tokef`, last4 from the VERIFY raw in
  the callback and store on `users`.
- `chargeToken({ token, tokef, amount, coin, info, orderId })` → server-to-server
  `action=pay` with `Token`+`Tokef`+signature → `{ ok, ccode, transactionId, raw }`.
  ⚠️ exact params verified on the live masof before enabling.

### Flows
- **Change card** → new hosted payment with `HK=True` for a token refresh
  (minimal/auth amount per Yaad), update stored token/last4.
- **Auto-renew** (cron Phase C extended) → for `auto_renew` users at `paidUntil`
  with a token: `chargeToken` for the period amount → on success extend
  `paidUntil` (insert `payment_orders` kind `renewal`); on failure → retry window
  then `expired` + email.
- **Upgrade one-click** → if token present, `chargeToken` the new period amount
  immediately instead of opening the hosted modal.

**Gate:** auto-renew cron + token charge stay behind an env flag
(`HYP_TOKENS_ENABLED`) until a real masof test confirms the token-charge contract.

---

## Files

**New:** `lib/subscription.ts` (+ test), `app/api/dashboard/billing-stats/route.ts`,
`app/api/dashboard/subscription/{cancel,resume,schedule-change}/route.ts`,
`app/[locale]/dashboard/billing/charts/{MinutesGauge,CallsPerDayChart,SpendChart,OutcomeDonut}.tsx`,
`app/api/cron/billing/route.ts`, `drizzle/0021_*`.

**Modified:** `lib/db/schema.ts`, `app/api/calls/end/route.ts`,
`app/[locale]/dashboard/billing/{page,client}.tsx`, `lib/hyp.ts` (Phase D),
`app/[locale]/dashboard/settings/delete-account-section.tsx` (extract embeddable),
`messages/{fr,he,en}.json`, `.env.example` (`HYP_TOKENS_ENABLED`), `package.json`
(recharts).

**Reused:** `lib/billing-activation.ts` (`addPeriod`/`nextPaidUntil`),
`lib/plans.ts` + `lib/plan-pricing*.ts`, `payment_orders`, `PlanCard`,
`resolveScopeUserId`, `lib/release-user.ts` (delete).

## Verification
- `tsc --noEmit` + `eslint` clean on all new/changed files.
- `lib/subscription.ts` unit tests (classifyChange, period window, downgrade date).
- Dev: billing page renders charts from `billing-stats`; cancel/resume/schedule
  reflect correct dates; receipts list; delete-account works.
- Phase D token charge tested on the masof before enabling `HYP_TOKENS_ENABLED`.
- Multi-agent build: parallel agents for the 4 chart components + `lib/subscription.ts`
  (+tests); foundation/payment/integration done in the main thread.
