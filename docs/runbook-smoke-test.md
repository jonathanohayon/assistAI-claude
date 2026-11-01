# Runbook: post-deploy smoke test

Run after every production deploy of the web service (and after rotating keys).

```bash
BASE_URL=https://aitamara.com \
INTERNAL_SECRET=<same value as on Railway> \
OPENAI_API_KEY=<the production key> \
  npx tsx scripts/smoke-prod.ts
```

Exit code `0` = all checks passed, `1` = at least one failed. Each line says what was expected.

## What it checks

| Check | Expected | A failure usually means |
|---|---|---|
| Landing `/` | 200 | Deploy failed or crashed at boot. Check the Railway deploy logs. |
| `/api/agent/config?phone=+97223764700` (internal secret) | 200 | The admin's number lost its `phone_numbers` row, or the trial gate cut the admin. |
| `/api/agent/config?phone=<unknown>` | 404 `unknown_number` | The silent default-tenant fallback is back: strangers' callers get another tenant's agent. |
| Anonymous `POST /api/calendar/find` and `/cancel` | 401 | The anonymous calendar sandbox is gone: anyone can read or delete events. |
| `GET https://api.openai.com/v1/models` with the prod key | 200 | **The voice agent cannot answer any call.** Rotate `OPENAI_API_KEY` on Railway (web + worker). |
| `--rate-limit` only: 6 anonymous `POST /api/session` | a 429 by the 6th | Anyone can mint Realtime sessions on our OpenAI bill. |

## Side effects (it is read-only, with two traces)

- The unknown-number probe logs one `unknown_dialed_number` event (level error). Expected; ignore it.
- `--rate-limit` mints up to 6 anonymous demo sessions (free unless used) and uses up **your IP's** demo quota for 10 minutes. You won't be able to try the landing demo from that IP right after. Off by default.
- Nothing is booked, cancelled, or written to a calendar or sheet. The calendar probes use a fake phone and a fake event id, so they match nothing even on a broken deploy.

## Options

| Env | Default | |
|---|---|---|
| `BASE_URL` | `https://aitamara.com` | Target. Works against a local `next start` too. |
| `KNOWN_PHONE` | `+97223764700` | A number that must resolve to a tenant. |
| `UNKNOWN_PHONE` | `+15555550100` | Reserved fictional US number, never ours. |

## Not covered (do it by hand after a deploy that touches calls)

Place one real call to `+97223764700` and check in the events table: `call_started`, `agent_config_loaded` (`phone_match`), `call_metrics` with a non-zero `greetingMs`, and `twilio_signature_valid` if the call went through the voice bridge.
