// COMPATIBLE WRAPPER (Knowledge S2): outbound learning now lives in the one
// learning service, lib/knowledge/learn.ts. Kept so
// /api/dashboard/campaigns/learn and its callers keep working unchanged until
// S3 replaces the outbound tile. SERVER-ONLY.

export { distillKnowledge as learnFromSites, MAX_LEARN_URLS, type LearnResult } from "@/lib/knowledge/learn";
