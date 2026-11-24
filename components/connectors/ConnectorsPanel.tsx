"use client";

// The connectors list on the live Connect page (C1b). The server sends the
// page (lib/connectors/mount.ts, the same reader as GET
// /api/dashboard/connectors); this file wires the actions that have a real
// route today, and ONLY those:
//   the legacy (derived) card
//     switch   → PUT /api/dashboard/tools { tools: { clientAgent: { enabled } } },
//                the brick's own save request (clientAgentSwitchRequest);
//     Tester   → POST /api/dashboard/tools/client-agent/test, the brick's
//                test route, on the stored address and secret;
//     Modifier → opens today's "Votre agent IA" editor (ClientAgentBrick)
//                in place, under the list.
//   the empty card's "Commencer" → the same editor (VP, 24/11: until the
//     wizard exists, the first agent is connected there; once saved, the
//     setting comes back as the derived card).
//   a real connector card (none can exist yet): its actions have no route,
//     so they are disabled with one plain line (ConnectorsList.actionsSoon).
//   "+ Ajouter un agent": the wizard (C2) does not exist: drawn disabled
//     with "Bientôt : ajoutez vos agents ici." (addSoon).
// ?asUserId on EVERY request in the admin tenant view.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";
import { FOCUS } from "@/components/bricks/controls";
import {
  clientAgentSaveRefusal,
  clientAgentStoredTestRequest,
  clientAgentSwitchRequest,
  clientAgentTestWords,
  type ClientAgentRefusal,
  type TestWords,
} from "@/components/bricks/tools/tools-ui";
import { ConnectorsList, type CardActions } from "@/components/connectors/ConnectorsList";
import type { ConnectorBasePrice, ConnectorCardView, ConnectorExtraPrice } from "@/lib/connectors/list-view";
import type { ConnectorsPageView } from "@/lib/connectors/types";

export const LEGACY_ID = "legacy";

export type ConnectorsPanelProps = {
  page: ConnectorsPageView;
  extraPrice: ConnectorExtraPrice | null;
  basePrice: ConnectorBasePrice | null;
  /** Admin tenant view: every request carries ?asUserId. */
  asUserId?: string | null;
  /** Tests and captures: start with the editor open. */
  initialEditorOpen?: boolean;
};

const qs = (asUserId: string | null | undefined) => (asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "");
const CLOSE = `inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline ${FOCUS}`;

type Note = { kind: "test"; words: TestWords | "running" } | { kind: "switch"; refused: ClientAgentRefusal | null };

/** The legacy card's switch, as the page applies it after a successful save. */
export function withLegacyEnabled(page: ConnectorsPageView, enabled: boolean): ConnectorsPageView {
  return {
    ...page,
    connectors: page.connectors.map((c) => (c.id === LEGACY_ID ? { ...c, enabled, state: enabled ? "online" : "off" } : c)),
  };
}

/** Whether a card's actions have a route today: only the derived legacy card's. */
export function cardActionsMode(card: Pick<ConnectorCardView, "id" | "derived">): CardActions["mode"] {
  return card.derived && card.id === LEGACY_ID ? "live" : "soon";
}

export function ConnectorsPanel({ page: initial, extraPrice, basePrice, asUserId = null, initialEditorOpen = false }: ConnectorsPanelProps) {
  const t = useTranslations("ConnectorsList");
  const tAgent = useTranslations("ToolsBrick.agent");
  const tTools = useTranslations("ToolsBrick");
  const [page, setPage] = useState(initial);
  const [editorOpen, setEditorOpen] = useState(initialEditorOpen);
  // A new key remounts the editor: it re-reads the setting after the card's switch wrote it.
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [scrollToEditor, setScrollToEditor] = useState(false);

  useEffect(() => {
    if (!scrollToEditor || !editorOpen) return;
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToEditor(false);
  }, [scrollToEditor, editorOpen]);

  const openEditor = () => {
    setEditorOpen(true);
    setScrollToEditor(true);
  };

  // After the editor saved: the page as the server now reads it (the setting
  // may have become, or stopped being, the derived card).
  const refresh = useCallback(() => {
    fetch(`/api/dashboard/connectors${qs(asUserId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ConnectorsPageView>) : Promise.reject(new Error(String(r.status)))))
      .then((p) => setPage(p))
      .catch(() => {});
  }, [asUserId]);

  const onToggle = async (id: string, enabled: boolean) => {
    if (id !== LEGACY_ID || busy) return;
    const req = clientAgentSwitchRequest(enabled, asUserId);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(req.url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: req.body });
      const data = (await res.json().catch(() => null)) as { tools?: unknown } | null;
      if (!res.ok || !data?.tools) {
        setNote({ kind: "switch", refused: clientAgentSaveRefusal(res.status, data) });
        return;
      }
      // Kept on screen until the next read: switched off, the setting is no
      // longer a derived card for the server, but the user sees what they did.
      setPage((p) => withLegacyEnabled(p, enabled));
      setEditorKey((k) => k + 1);
    } catch {
      setNote({ kind: "switch", refused: null });
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (id: string) => {
    if (id !== LEGACY_ID) return;
    const req = clientAgentStoredTestRequest(asUserId);
    setNote({ kind: "test", words: "running" });
    try {
      const res = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body });
      setNote({ kind: "test", words: clientAgentTestWords(res.status, await res.json().catch(() => null)) });
    } catch {
      setNote({ kind: "test", words: { key: "generic" } });
    }
  };

  const noteNode = (n: Note | null) => {
    if (!n) return undefined;
    if (n.kind === "switch") {
      return (
        <span className="font-semibold text-[#b91c1c]">
          {n.refused === "disabled" ? tAgent("refused.disabled") : tTools("saveError")}
        </span>
      );
    }
    if (n.words === "running") return <span className="text-[#475569]">{tAgent("testing")}</span>;
    const w = n.words;
    return (
      <span className={w.key === "ok" ? "font-semibold text-[#047857]" : "text-[#92400e]"}>
        {w.key === "ok" ? tAgent("test.ok", { ms: w.ms }) : tAgent(`test.${w.key}`)}
      </span>
    );
  };

  const actionsFor = (card: ConnectorCardView): CardActions => {
    const mode = cardActionsMode(card);
    if (mode === "soon") return { mode };
    return { mode, busy, note: noteNode(note) };
  };

  return (
    <div className="space-y-5" data-connectors-panel>
      <ConnectorsList
        page={page}
        extraPrice={extraPrice}
        basePrice={basePrice}
        actionsFor={actionsFor}
        addSoon
        onToggle={(id, v) => void onToggle(id, v)}
        onTest={(id) => void onTest(id)}
        onEdit={(id) => {
          if (id === LEGACY_ID) openEditor();
        }}
        onAdd={openEditor}
      />
      {editorOpen && (
        <div ref={editorRef} className="scroll-mt-24 space-y-2" data-connector-editor>
          <div className="flex justify-end">
            <button type="button" className={CLOSE} onClick={() => setEditorOpen(false)} data-editor-close>
              {t("closeEditor")}
            </button>
          </div>
          <ClientAgentBrick key={editorKey} asUserId={asUserId} onSaved={refresh} />
        </div>
      )}
    </div>
  );
}
