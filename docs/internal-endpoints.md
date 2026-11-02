# Internal ops endpoints

Machine-to-machine and ops-only routes. All of them require the
`INTERNAL_SECRET` in the **`x-internal-secret` header** (never in the URL:
a query string ends up in HTTP logs and browser history). Wrong or missing
secret → `401 {"error":"unauthorized"}`.

```bash
# Set once per shell, from your own copy of the secret (never paste it in a ticket or a PR).
export APP=https://aitamara.com
export S="$INTERNAL_SECRET"

# Diagnostics (GET)
curl -s -H "x-internal-secret: $S" "$APP/api/debug/latest-call"
curl -s -H "x-internal-secret: $S" "$APP/api/debug/tenants"
curl -s -H "x-internal-secret: $S" "$APP/api/admin/internal-tenants-status"
curl -s -H "x-internal-secret: $S" "$APP/api/admin/internal-recent-events"

# Admin actions (POST, JSON body; see each route for its fields)
curl -s -X POST -H "x-internal-secret: $S" -H "Content-Type: application/json" \
  -d '{"email":"tenant@example.com","ownerWhatsapp":"+15550000000"}' \
  "$APP/api/admin/internal-set-whatsapp"
```

| Route | Method | Purpose |
|---|---|---|
| `/api/debug/latest-call` | GET | Latest call, summary and related events (recap pipeline debugging) |
| `/api/debug/tenants` | GET | All tenants with phone numbers and a prompt snippet |
| `/api/admin/internal-tenants-status` | GET | Every tenant: role, Google connected, WhatsApp, phones |
| `/api/admin/internal-recent-events` | GET | Recent events |
| `/api/admin/internal-set-whatsapp` | POST | Set a tenant's owner WhatsApp |
| `/api/admin/internal-set-persona` | POST | Update a tenant's instructions / greeting / voice / language |
| `/api/admin/internal-set-subscription` | POST | Flip subscription status / plan, optionally clear trial dates |
| `/api/admin/internal-apply-default-prompt` | POST | Reset a tenant's prompt to the canonical default |
| `/api/admin/internal-restore-admin-google` | GET / POST | Diagnose / restore a user's Google tokens from env |

The worker also calls the `/api/agent/*`, `/api/calls/end`, `/api/events`
and calendar tool routes with the same header (`src/web-api.ts` in the
worker repo).

Changed 2026-11-02: `/api/debug/*` used to take `?token=<secret>`; that form
no longer works.
