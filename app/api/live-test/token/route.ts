// POST /api/live-test/token — the browser's token for a live test call (the
// dashboard's "Tester en direct"). A NEUTRAL path: the former
// /api/livekit/web-token named a supplier in a URL the tenant's browser
// requests. Same handler; the old path stays as an alias for one release.
export { POST } from "@/app/api/livekit/web-token/route";
