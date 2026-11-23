"use client";

import dynamic from "next/dynamic";

/**
 * The older "who answers" card (AgentBrainSection), behind a dynamic import:
 * its code is a separate chunk, fetched only where the card renders (an admin
 * session, see connect-owned.tsx). A tenant's page loads this stub only, never
 * the card's code. (A Server Component's dynamic import of a Client Component
 * is not code-split, so the split lives in this client stub.)
 */
export const AdminBrainSectionLazy = dynamic(() =>
  import("../settings/agent-brain-section").then((m) => m.AgentBrainSection),
);
