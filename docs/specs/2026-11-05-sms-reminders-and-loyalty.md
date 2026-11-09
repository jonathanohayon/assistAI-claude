# Spec — SMS reminder fallback + client loyalty (P2, no code yet)

Status: proposal · Owner: tamaraVlad (BE) · Date: 2026-11-05

## 1. SMS fallback for J-1 reminders

### Today
- `/api/cron/appointment-reminders` sends a WhatsApp message the day before each Google Calendar booking (`lib/reminders.ts`, `lib/whatsapp.ts`).
- Idempotency comes from `appointment_reminders (user_id, event_id)` unique, and the `channel` column already exists (default `whatsapp`).
- A client without WhatsApp gets nothing. The send returns `ok`, and the failure only shows up later as an async Twilio status (`undelivered`/`failed`). No status callback is wired today, so the cron never sees the failure.

### Proposal
1. **Detect failure.** Add a `statusCallback` on the reminder send → `POST /api/webhooks/twilio/reminder-status`, with a Twilio signature check. On `failed`/`undelivered`, mark the row `whatsapp_failed` and queue an SMS.
2. **Send the SMS.** Use Twilio Messages with an alphanumeric sender (tenant business name, ≤ 11 chars, Latin only), falling back to the tenant's Twilio number. Write one extra row with `channel = 'sms'`, so the idempotency key becomes `(user_id, event_id, channel)`.
3. **Keep the text short.** It's the same content as `reminderText()` but trimmed for SMS. Hebrew is UCS-2: 70 chars per segment, 67 when concatenated. Target ≤ 2 segments.
4. **Respect quiet time.** Don't send between Friday 14:00 and Saturday night (Asia/Jerusalem), nor at night. If the J-1 window falls on Shabbat, send Thursday evening.
5. **Make it opt-in.** Add a `sms_fallback_enabled` flag (default false) on `agent_configs`, gated by plan via `plan_features`.

### Numbers
- **Price.** Twilio lists Israel outbound at **$0.2575 per segment**, with alphanumeric at the same rate. Failed messages cost $0.001. A 2-segment Hebrew reminder costs about **$0.52**, against a few cents for WhatsApp.
- **Cap.** At $0.52, 100 SMS fallbacks a month is about $52. Add a monthly cap per tenant (default 100), surface it in Finance, and alert at 80 %.
- **Billing.** Count it as overage, or include it only in Clinique / Multi-sites (decision for the PM).

### Sender ID (Israel), to confirm with Twilio before building
- Twilio's guidelines say numeric sender IDs are replaced by generic alphanumeric ones on some networks (Golan, Azi). Whether Israel needs alphanumeric **pre-registration** is not settled in public docs, so we need to ask Twilio support or test in the Console.
- Generic sender names (INFO, SMS, NOTICE) are refused by some carriers. Use the business name.
- Alphanumeric is one-way, so clients can't reply.

### Opt-out
- A reminder for a booked appointment is a service message, not advertising, so the Israeli anti-spam law (Communications Law §30A) consent rule does not apply. Still, each SMS ends with a short opt-out line, for example "להסרה: <short link>".
- The link writes to a new `sms_opt_outs (user_id, phone)` table, and the cron checks it before sending.
- Twilio STOP handling only covers numeric senders.
- **No marketing over SMS** (see §2): that would need prior written consent.

### Tests
- Status webhook: signature rejected, failed → SMS queued, delivered → no SMS.
- Idempotency per channel.
- Shabbat window → shifted to Thursday.
- Opt-out respected.
- Cap reached → skipped, with an alert.

## 2. Client loyalty (visit count)

### Today
- Bookings live only in the tenant's Google Calendar, and contacts live in their Google Sheet.
- No table counts visits per client.

### Proposal
1. **Data.** Add a `client_visits` table: `(id, user_id, client_phone E.164, event_id, visit_at, status booked|cancelled|done)`, with `(user_id, event_id)` unique and cascade on tenant delete.
   - Written by `/api/calendar/book` (booked) and by the cancel path.
   - Once `visit_at` has passed, a nightly job (the `sync-tenants` cron) marks the visit `done`, or `cancelled` if the event has disappeared from Calendar.
   - One-off backfill: Calendar events from the last 12 months, phones parsed with `parseEventContact()`.
2. **Deterministic tier, computed server-side** (per our reliability rule: logic in code, not in the prompt).
   - Tiers: `new` (0 done), `returning` (1–4), `loyal` (≥ 5). Thresholds are configurable per tenant.
   - Optional reward: "every Nth visit → <tenant text>".
3. **Agent use.**
   - At call start the worker calls `GET /api/agent/client-profile?phone=` (INTERNAL_SECRET), which returns `{ visits, lastVisitAt, tier, rewardDue }`.
   - It injects one fact line into the per-call context (worker #22), for example "Returning client, 6 visits, last on 12/10; reward due: 10 % off".
   - The agent greets by name if known and mentions the reward only when `rewardDue` is true.
   - The lookup has a 300 ms timeout. Without it, the call goes on unchanged.
4. **Dashboard.**
   - In the Contacts view: Visits, Last visit and Tier columns, plus a filter.
   - In Settings: tier thresholds and reward text.
   - A small KPI on the home page: returning-client rate over 30 days.

### Out of scope (v1)
- Marketing messages to loyal clients: SMS needs consent; WhatsApp needs a marketing template and opt-in.
- Points or wallet systems.

### Privacy
- Phone numbers are personal data and stay tenant-scoped. The data is deleted with the tenant.
- It is never shown across tenants.
- Tests and PRs use mock numbers only.

### Tests
- Booked → done → tier transitions.
- A cancellation doesn't count.
- Backfill is idempotent.
- The profile endpoint returns 401 without the secret.
- A timeout leaves the call unaffected.

## 3. Estimate (BE + FE)
- SMS fallback: about 1.5 days, after Twilio confirms the sender ID.
- Loyalty: about 2.5 days (table and backfill 1 day, endpoint and worker 0.5 day, dashboard 1 day).

## Open questions for the PM
1. Should the SMS fallback be included in Clinique only, or billed as overage for everyone?
2. Default loyalty thresholds (5 visits?) and whether a reward ships in v1 or only the count.
