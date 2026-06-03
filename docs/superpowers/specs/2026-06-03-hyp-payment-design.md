# HYP Payment Integration — Tamara (design)

Date: 2026-06-03 · Branch: `feat/hyp-payment`

## Goal

Let a tenant pay from `/dashboard/billing` to convert from free trial to a paid
subscription, via the HYP (Yaad / `icom.yaad.net` Pay-Protocol) hosted page —
replicating the working integration from the `shabespresso` project, but adapted
to Tamara's subscription model and hardened for the security risk a SaaS adds.

Reuses the **shabespresso HYP merchant account** (same `HYP_TERMINAL` / `HYP_KEY` /
`HYP_PASSP`).

## Model decisions

- **One-shot charge per period** (monthly / annual), NOT token recurring. On
  success: `subscriptionStatus = active`, store `paidUntil`, clear trial dates.
  At expiry → warning email + cron flips back to `expired`. (Token recurring is a
  possible v2.)
- **Dual currency**: `he` locale → ILS (`Coin=1`), `fr`/`en` → EUR (`Coin=3`).
  ⚠️ The masof `5603776126` historically only billed ILS — EUR must be confirmed
  on the terminal. Code supports both; EUR can be gated via config if refused.
- Currency is **resolved server-side** from the tenant locale and **stored on the
  order** (auditable, never trusted from the client).

## Security model (from council / gpt-5.2 review)

The shabespresso flow only checks `CCode==0` on the front-channel return. For a
SaaS where the return *grants paid access*, that is insufficient. Hardening:

1. **Pending order created server-side before redirect**, keyed by an opaque
   random `orderId` (the `payment_orders.id` UUID). Stores `userId, planKey,
   period, currency, coin, expectedAmount, status=pending, expiresAt`.
2. **Return handler validates more than CCode**: re-calls HYP `APISign What=VERIFY`
   (HYP re-checks its own signature → a forged redirect can't fake `CCode=0`), AND
   binds the returned `Order` + `Amount` + `Coin` to the stored order. Any mismatch
   → reject.
3. **Idempotency**: unique constraint on `payment_orders.hyp_transaction_id`; the
   activation runs in a DB transaction with row lock; `paidUntil = max(current,
   now) + period` so refreshes/retries don't stack.
4. **Cron race**: creating a pending order sets `users.deletion_locked_until =
   now + 2h`; `trial-cleanup` Phase 2 excludes users whose lock is still active so
   a payment in-flight at trial expiry is never deleted.

## Components

### Schema (`lib/db/schema.ts`) + migration
- `users`: add `paid_until` (timestamptz, null), `deletion_locked_until`
  (timestamptz, null).
- New table `payment_orders`:
  `id` uuid pk · `user_id` fk→users cascade · `plan_key` · `period`
  (`monthly`|`annual`) · `currency` (`ILS`|`EUR`) · `coin` · `expected_amount`
  real · `status` (`pending`|`paid`|`failed`) default `pending` ·
  `hyp_transaction_id` text null (unique) · `raw_response` jsonb null ·
  `created_at` · `paid_at` null · `expires_at`.

### `lib/hyp.ts` (ported + adapted)
- `creds()` from env (`HYP_TERMINAL`/`HYP_PASSP`/`HYP_KEY`).
- `CURRENCY_COIN = { ILS: "1", EUR: "3" }`, `pageLangFor(locale)`,
  `currencyForLocale(locale)`.
- `createPaymentUrl({ orderId, amount, coin, info, pageLang, email, baseUrl,
  successUrl, cancelUrl })` → APISign SIGN, returns signed URL.
- `verifyPayment(params)` → APISign VERIFY → `{ ok, ccode, raw }`.

### `lib/billing-pricing.ts`
- `priceFor(planKey, period, currency)` → amount. EUR from existing `lib/plans.ts`
  numbers; ILS placeholders (⚠️ flagged TODO, to confirm with owner).

### API routes
- `POST /api/dashboard/hyp/create-payment` (auth tenant): body `{ plan, period }`.
  Resolve currency from `users.locale`, compute amount server-side, insert
  `payment_orders` row, set `deletion_locked_until`, return `{ url }`.
- `GET /api/dashboard/hyp/callback` (HYP success/cancel redirect target):
  VERIFY + bind order/amount/coin, transactional idempotent activation, redirect
  to `/{locale}/dashboard/billing?paid=1` or `?payment=failed`.

### Billing UI (`app/[locale]/dashboard/billing/*`)
- Replace the "Stripe en cours" note + no-op plan switch with a **Subscribe**
  button → POST create-payment → `window.location = url`.
- Show price in the locale currency (ILS for `he`, EUR otherwise).

### Cron (`app/api/cron/trial-cleanup/route.ts`)
- Phase 2 deletion query excludes `deletion_locked_until > now`.

### i18n (`messages/{fr,he,en}.json`)
- Keys for subscribe CTA, currency, paid/failed toasts.

### Env (`.env.example` + Railway + local `.env.local`)
- `HYP_TERMINAL`, `HYP_KEY`, `HYP_PASSP`, `HYP_API_URL`.

## Out of scope (YAGNI)
- Token-based recurring billing.
- Invoicing (Yeshinvoice) — can be added later, mirroring shabespresso.
- Proration / mid-period plan changes.

## Open items for the owner
- Confirm EUR is enabled on masof `5603776126` (else gate EUR).
- Provide real **ILS prices** per plan/period (placeholders used until then).
