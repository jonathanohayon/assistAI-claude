// A fake HYP for the DB suite: replaces globalThis.fetch. Only the mock host
// (MOCK_HYP_URL) is answered; ANY other URL throws, so nothing in the code
// under test can reach the network. Every request is recorded with its
// parsed query.
//   What=SIGN   → "…&signature=mock-signature" (what createPaymentUrl needs);
//   What=VERIFY → the answer the test registered for that Order
//                 (verifyAnswers[order]), else CCode=902 (refused).
export const MOCK_HYP_URL = "http://hyp.mock.invalid/p/";

export type HypRequest = { what: string; params: Record<string, string> };
export const hypRequests: HypRequest[] = [];
export const verifyAnswers: Record<string, Record<string, string>> = {};

export function installMockHyp(): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    if (url.origin + url.pathname !== MOCK_HYP_URL) throw new Error(`network refused in tests: ${url.origin}`);
    const params = Object.fromEntries(url.searchParams.entries());
    hypRequests.push({ what: params.What ?? "", params });
    if (params.What === "SIGN") {
      const q = new URLSearchParams({ ...params, signature: "mock-signature" });
      q.delete("KEY");
      q.delete("PassP");
      return new Response(q.toString(), { status: 200 });
    }
    if (params.What === "VERIFY") {
      const a = verifyAnswers[params.Order ?? ""] ?? { CCode: "902" };
      return new Response(new URLSearchParams(a).toString(), { status: 200 });
    }
    return new Response("CCode=999", { status: 200 });
  }) as typeof fetch;
}
