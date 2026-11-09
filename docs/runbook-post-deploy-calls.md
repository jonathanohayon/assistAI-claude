# Runbook — post-deploy test calls (November 2026 batch)

One checklist for the test session with Jonathan, once the November PRs
are merged and deployed (web through #170, worker through #30). Each
check gives the action, where to look (read-only) and pass/fail.

All values below are **mocks**: `+97220000000` = the tenant's aitamara
number, `+97230000000` = the salon's usual business number, `+972500000000`
= the phone the test call comes from. Use the real ones live, never paste
them into PRs or commits (the repos are public).

## Before the calls

| Check | Where to look | Pass |
|---|---|---|
| Web and worker on the merged commits | Railway → each service → Deployments: active deployment's commit | Web includes #170, worker includes #30 |
| Crons reach the web | Railway web HTTP logs, filter `/api/cron/` over the last hour | `200` on `/api/cron/monitor` (every 5 min) |
| Test tenant has: owner WhatsApp, Google Calendar connected, transfer number, AI disclosure ON | `/admin/users/<id>` (admin view of the tenant config) | All four set |

Log commands below use the Railway CLI with the project token; poll with
`--since`, don't stream (a stream dies on redeploy):

```sh
railway logs --service worker --since 30m | grep '<pattern>'
railway logs --service web --since 30m | grep '<pattern>'
```

SQL is read-only. Run it from the Railway Postgres "Query" tab or
`railway connect Postgres`, never from a local build pointed at prod.

## 1. Worker heartbeat and monitor

| Check | Where to look | Pass / fail |
|---|---|---|
| One heartbeat loop | `railway logs --service worker --since 30m \| grep '\[heartbeat\] started'` | **Pass:** exactly one `[heartbeat] started in main worker process pid=…` per deploy. **Fail:** one per job process, or none. |
| Heartbeats arrive | `SELECT value::json->>'at' AS at_ms, updated_at FROM app_settings WHERE key = 'worker_heartbeat';` | **Pass:** `updated_at` less than 12 min ago. |
| No heartbeat errors | `railway logs --service worker --since 30m \| grep '\[heartbeat\] '` | **Fail:** any `[heartbeat] /api/agent/heartbeat -> 4xx/5xx` or `[heartbeat] failed:` line. |
| Monitor alerts quiet | `SELECT created_at, message FROM events WHERE event = 'admin_alert_sent' ORDER BY created_at DESC LIMIT 5;` | **Pass:** no `worker_heartbeat_stale` / `model_key_invalid:*` alert since the deploy. |

## 2. Call 1 — AI disclosure + booking (call the aitamara number directly)

From `+972500000000`, call `+97220000000`. Book an appointment for
**tomorrow** (it feeds the J-1 reminder check, §6).

| Check | Where to look | Pass / fail |
|---|---|---|
| Disclosure heard | By ear, first sentence | **Pass:** the greeting says the agent is an AI ("… une intelligence artificielle", "… בינה מלאכותית", "… an AI assistant"), once, not twice. |
| Pre-rendered opener used | `railway logs --service worker --since 10m \| grep '\[opener\]'` | **Pass:** `[opener] ok <n> bytes in <ms> ms` (on a cache miss, the next call should be `ok`). |
| Same text in both paths | `SELECT metadata->>'greetingInstructions' FROM events WHERE event = 'chatctx_snapshot' ORDER BY created_at DESC LIMIT 1;` | **Pass:** contains the disclosure sentence. |
| Booking stamped with the call id | `SELECT metadata->>'callId' AS call_id, created_at FROM events WHERE event = 'book_success' ORDER BY created_at DESC LIMIT 1;` | **Pass:** 16 lowercase hex chars (e.g. `f39f8112641da664`). **Fail:** null, or anything containing digits of a phone number (raw room name leaked). |
| Call row carries the same id and the type | `SELECT call_id, call_type, duration_seconds FROM calls ORDER BY created_at DESC LIMIT 1;` | **Pass:** `call_id` = the booking's `callId`, `call_type = 'RDV'`. |
| Sheet "Appels" type | Tenant's Google Sheet → tab `Appels` → newest row, column `Type` | **Pass:** `RDV`. |

## 3. Call 2 — transfer

Call again and ask to speak to someone ("je veux parler à quelqu'un").

| Check | Where to look | Pass / fail |
|---|---|---|
| Transfer phrase | By ear | **Pass:** one short sentence announcing the transfer, then ringing on the transfer number. **Fail:** silence, or the agent keeps talking over the ring. |
| Transfer event | `SELECT metadata->>'ok' AS ok, metadata->>'callId' AS call_id, message FROM events WHERE event = 'call_transfer' ORDER BY created_at DESC LIMIT 1;` | **Pass:** `ok = true`, `call_id` 16 hex chars. If `ok = false`, read `metadata->>'error'` (trunk SIP REFER not enabled is the usual cause). |
| Call type | `SELECT call_type FROM calls ORDER BY created_at DESC LIMIT 1;` | **Pass:** `Transfert`. |

## 4. Forwarding test from a second phone

In the dashboard wizard, start the forwarding test (enter `+97230000000`
as the business number). The salon's usual line must forward to
`+97220000000`. From a **second phone** (not the owner's), call
`+97230000000` and don't pick up.

| Check | Where to look | Pass / fail |
|---|---|---|
| Wizard turns green | Dashboard wizard (polls `GET /api/dashboard/forwarding-test`) | **Pass:** `status: "detected"` within the 10-min window. |
| Stored | `SELECT forwarding_verified_at, forwarding_verified_method FROM agent_configs WHERE user_id = '<tenant id>';` + `SELECT metadata FROM events WHERE event = 'forwarding_verified' ORDER BY created_at DESC LIMIT 1;` | **Pass:** `forwarding_verified_at` set; method `window` (expected today). |
| Does the Diversion header arrive? | LiveKit Cloud → Sessions → the call's room → SIP participant → Attributes | **Record the answer:** a `sip.h.diversion` (or `sip.h.history-info`) attribute = yes. None = the inbound trunk doesn't map headers to attributes (`lk sip inbound list` → `headers_to_attributes`) — then `verifiedMethod` stays `window`; open a board item to wire it. |

## 5. Owner digest — next morning

| Check | Where to look | Pass / fail |
|---|---|---|
| Cron ran | Railway web HTTP logs, `/api/cron/owner-digest`, around 05:00 UTC | **Pass:** `200`. |
| Sent | `SELECT metadata FROM events WHERE event IN ('owner_digest_sent','owner_digest_failed') ORDER BY created_at DESC LIMIT 3;` | **Pass:** `owner_digest_sent` with `day` = yesterday and `calls` ≥ 3, `bookings` ≥ 1, `transfers` ≥ 1. |
| Received | Owner's WhatsApp | **Pass:** one message "☀️ Bilan d'hier (…)" with matching counts, in the tenant's language. Not received + `owner_digest_sent` = template/24 h window issue (check `WHATSAPP_OWNER_TEMPLATE_SID_*`). |

## 6. J-1 reminder — the evening before the call-1 appointment

| Check | Where to look | Pass / fail |
|---|---|---|
| Cron ran | Railway web HTTP logs, `/api/cron/appointment-reminders` | **Pass:** `200`. |
| Sent | `SELECT status, channel, error, appointment_start FROM appointment_reminders ORDER BY sent_at DESC LIMIT 3;` + events `appointment_reminder_sent` / `appointment_reminder_failed` | **Pass:** a `sent` row for the call-1 booking. |
| Received | The phone that booked | **Pass:** one WhatsApp reminder with tomorrow's date and time. |

## Results

Record pass/fail for each section in the board item "Post-deploy test
calls", with the date. Any fail → its own board item, linked.
