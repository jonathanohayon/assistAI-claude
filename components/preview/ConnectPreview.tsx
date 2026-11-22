"use client";

/**
 * Votre agent, not owned (F2): the REAL client-agent brick, read-only, with
 * the sample answer (a sample agent address, switched on) and a sample test
 * result. The brick makes no request in this mode: it never loads, saves or
 * tests, so it never pings an address.
 */

import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";
import { PREVIEW_CLIENT_AGENT, PREVIEW_CLIENT_AGENT_TEST } from "@/lib/preview-samples";

import { PreviewFrame } from "./PreviewFrame";

const SAMPLE = { served: PREVIEW_CLIENT_AGENT, test: PREVIEW_CLIENT_AGENT_TEST };

export function ConnectPreview() {
  return (
    <PreviewFrame>
      <ClientAgentBrick sample={SAMPLE} />
    </PreviewFrame>
  );
}
