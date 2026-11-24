// The help page "How to get your agent's address" (/dashboard/agent/help):
// the contract facts and the copyable example, built from the SAME constants
// as the request Tamara sends (lib/tools/client-agent-test.ts, which mirrors
// the worker's src/client-agent.ts). Nothing here is typed twice: the page
// and its test read these values, so a contract change shows on the page.
// SERVER-ONLY by import (client-agent-test.ts uses node:crypto): the page
// content is a server component; client parts receive plain strings.

import {
  CLIENT_AGENT_SIGNATURE_HEADER,
  CLIENT_AGENT_TEST_BUDGET_MS,
  CLIENT_AGENT_TEST_MAX_BYTES,
  CLIENT_AGENT_USER_AGENT,
  clientAgentTestBody,
} from "@/lib/tools/client-agent-test";

/** The request body's fields, in the order Tamara sends them. */
export const CLIENT_AGENT_REQUEST_FIELDS = Object.keys(JSON.parse(clientAgentTestBody("fr")) as Record<string, unknown>) as readonly string[];

/** Placeholder address of every example (never a real host). */
export const EXAMPLE_AGENT_URL = "https://agent.example.test/ask";
/** Mock call id, in the real format (16 lowercase hex characters). */
export const EXAMPLE_CALL_ID = "3f9a1c2e7b4d8a60";

export const helpFacts = {
  header: CLIENT_AGENT_SIGNATURE_HEADER,
  userAgent: CLIENT_AGENT_USER_AGENT,
  /** "2.5": the budget in seconds, formatted by the page per locale. */
  budgetSeconds: CLIENT_AGENT_TEST_BUDGET_MS / 1000,
  maxKb: CLIENT_AGENT_TEST_MAX_BYTES / 1024,
};

export type ExampleWords = { question: string; callerSaid: string; prevUser: string; prevAgent: string; answer: string };

/** The example request body: exactly the contract's fields, mock values. */
export function exampleRequestBody(language: string, w: ExampleWords): Record<string, unknown> {
  const values: Record<string, unknown> = {
    call_id: EXAMPLE_CALL_ID,
    turn_id: 2,
    language,
    question: w.question,
    caller_said: w.callerSaid,
    history: [
      { role: "user", text: w.prevUser },
      { role: "agent", text: w.prevAgent },
    ],
  };
  // Same keys, same order as the real request (a new field fails the test).
  return Object.fromEntries(CLIENT_AGENT_REQUEST_FIELDS.map((k) => [k, values[k]]));
}

export function exampleRequestText(language: string, w: ExampleWords): string {
  return [
    `POST ${EXAMPLE_AGENT_URL}`,
    "Content-Type: application/json",
    `User-Agent: ${CLIENT_AGENT_USER_AGENT}`,
    `${CLIENT_AGENT_SIGNATURE_HEADER}: <HMAC-SHA256 hex>`,
    "",
    JSON.stringify(exampleRequestBody(language, w), null, 2),
  ].join("\n");
}

export function exampleResponseText(w: ExampleWords): string {
  return ["HTTP/1.1 200 OK", "Content-Type: application/json", "", JSON.stringify({ answer: w.answer }, null, 2)].join("\n");
}

/** A minimal Node server (no dependency): checks the signature, answers. */
export function exampleServerText(w: ExampleWords): string {
  const header = CLIENT_AGENT_SIGNATURE_HEADER.toLowerCase();
  return `// server.mjs: node server.mjs (Node 18+, no dependency)
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

// The signing secret from the "Your AI agent" card.
const SECRET = process.env.AGENT_SECRET ?? "";

createServer((req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks); // sign the raw bytes, as received
    if (SECRET) {
      const expected = createHmac("sha256", SECRET).update(raw).digest("hex");
      const got = String(req.headers["${header}"] ?? "");
      if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
        return res.writeHead(401).end();
      }
    }
    const { question } = JSON.parse(raw.toString("utf8"));
    // Your agent's logic goes here: answer \`question\` in under ${helpFacts.budgetSeconds} s.
    const answer = ${JSON.stringify(w.answer)};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ answer }));
  });
}).listen(Number(process.env.PORT ?? 3000));
`;
}
