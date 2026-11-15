// Rate limits of the public agent webhook (/api/v1/agent/[token]), on the
// SHARED DB limiter (lib/rate-limit-db.ts): counts hold across replicas and
// restarts, unlike the in-memory per-process limiter this replaces.
//
// Four buckets, one per (method, key). GET and POST never share a budget.
//   *_ip     accountId = sha256(client IP). Counted BEFORE the token is
//            resolved, so guessing tokens from one address is slowed down too.
//   *_token  accountId = the resolved tenant id (never the raw token):
//            regenerating the URL does not reset the count.
// Every bucket also has a `global` ceiling: the backstop when clientIp() is
// unreliable (see lib/rate-limit.ts) or when many addresses are used.
//
// POST sizing: a real phone conversation makes at most ~20 turns a minute,
// so 60/min per tenant (the previous in-memory limit) never cuts a call but
// caps what a leaked URL costs (each POST is one LLM call on our bill). The
// per-IP POST limit is deliberately loose: a voice relay (e.g. tamaravox)
// calls on behalf of MANY tenants from one egress address.

export const AGENT_WEBHOOK_GET_IP_BUCKET = "agent_webhook_get_ip";
export const AGENT_WEBHOOK_GET_TOKEN_BUCKET = "agent_webhook_get_token";
export const AGENT_WEBHOOK_POST_IP_BUCKET = "agent_webhook_post_ip";
export const AGENT_WEBHOOK_POST_TOKEN_BUCKET = "agent_webhook_post_token";

export const AGENT_WEBHOOK_GET_WINDOW_MS = 60 * 60 * 1000;
export const AGENT_WEBHOOK_GET_PER_IP = 60;
export const AGENT_WEBHOOK_GET_PER_TOKEN = 60;
export const AGENT_WEBHOOK_GET_GLOBAL = 2000;

export const AGENT_WEBHOOK_POST_WINDOW_MS = 60 * 1000;
export const AGENT_WEBHOOK_POST_PER_IP = 300;
export const AGENT_WEBHOOK_POST_PER_TOKEN = 60;
export const AGENT_WEBHOOK_POST_GLOBAL = 1500;

/** What a 429 names: which limit was hit. */
export type AgentWebhookLimitScope = "ip" | "token" | "global";
