// /api/v1/demo-agent is a public, unauthenticated LLM endpoint (tamaravox test
// target) that calls OpenAI on our bill. Off unless DEMO_AGENT_ENABLED=true.
export function demoAgentEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.DEMO_AGENT_ENABLED === "true";
}
