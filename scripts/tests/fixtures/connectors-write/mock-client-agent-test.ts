// Test double for @/lib/tools/client-agent-test: records each test (url,
// whether a secret was passed, its value for the test to compare, the
// language) and answers globalThis.__agentTestResult. Never reaches a URL.
type Result = { ok: true; ms: number } | { ok: false; reason: string };
type Call = { url: string; secret: string | null; language: string };
const g = globalThis as { __agentTests?: Call[]; __agentTestResult?: Result };
export async function runClientAgentTest(args: Call): Promise<Result> {
  (g.__agentTests ??= []).push({ ...args });
  return g.__agentTestResult ?? { ok: true, ms: 42 };
}
