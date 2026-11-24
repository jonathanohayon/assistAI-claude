"use client";

// The connectors list on the live Connect page (C1b). The server sends the
// page (lib/connectors/mount.ts, the same reader as GET
// /api/dashboard/connectors); this file wires the actions that have a real
// route today, and ONLY those (requests: ./connector-actions.ts):
//   the legacy (derived) card
//     switch   → PUT /api/dashboard/tools { tools: { clientAgent: { enabled } } },
//                the brick's own save request (clientAgentSwitchRequest). When
//                that save switched it on without a secret, the server returns
//                the generated one ONCE (#437): the editor opens and shows it
//                in the brick's own one-time box (#439), memory only;
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
// ?asUserId on EVERY request in the admin tenant view. The door's deep link
// (/dashboard/agent#client-agent, the editor's anchor) opens the editor.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ClientAgentBrick } from "@/components/bricks/client-agent/ClientAgentBrick";
import { FOCUS } from "@/components/bricks/controls";
import type { ClientAgentRefusal, TestWords } from "@/components/bricks/tools/tools-ui";
import { connectorActions } from "@/components/connectors/connector-actions";
import { ConnectorsList, type CardActions } from "@/components/connectors/ConnectorsList";
import type { ConnectorBasePrice, ConnectorCardView, ConnectorExtraPrice } from "@/lib/connectors/list-view";
import type { ConnectorsPageView } from "@/lib/connectors/types";

export const LEGACY_ID = "legacy";
/** The editor's anchor (ClientAgentBrick's section id), as the door's first step links it. */
export const EDITOR_HASH = "#client-agent";

export type ConnectorsPanelProps = {
  page: ConnectorsPageView;
  extraPrice: ConnectorExtraPrice | null;
  basePrice: ConnectorBasePrice | null;
  /** Admin tenant view: every request carries ?asUserId. */
  asUserId?: string | null;
  /** The server's "now" for the relative dates (same text on the server and in the browser). */
  now?: string;
  /** Tests and captures: start with the editor open. */
  initialEditorOpen?: boolean;
};

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

export function ConnectorsPanel({ page: initial, extraPrice, basePrice, asUserId = null, now, initialEditorOpen = false }: ConnectorsPanelProps) {
  const t = useTranslations("ConnectorsList");
  const tAgent = useTranslations("ToolsBrick.agent");
  const tTools = useTranslations("ToolsBrick");
  const actions = useMemo(() => connectorActions((url, init) => fetch(url, init), asUserId), [asUserId]);
  const [page, setPage] = useState(initial);
  const [editorOpen, setEditorOpen] = useState(initialEditorOpen);
  // A new key remounts the editor: it re-reads the setting after the card's switch wrote it.
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [scrollToEditor, setScrollToEditor] = useState(false);
  // The secret the card's switch got back (once): handed to the editor, then forgotten.
  const [handoff, setHandoff] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const openEditor = () => {
    setEditorOpen(true);
    setScrollToEditor(true);
  };

  // Arriving on the editor's anchor (the connect door's first step) opens it.
  useEffect(() => {
    if (window.location.hash !== EDITOR_HASH) return;
    const id = window.setTimeout(() => {
      setEditorOpen(true);
      setScrollToEditor(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!scrollToEditor || !editorOpen) return;
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const id = window.setTimeout(() => setScrollToEditor(false), 0);
    return () => window.clearTimeout(id);
  }, [scrollToEditor, editorOpen]);

  const onToggle = async (id: string, enabled: boolean) => {
    if (id !== LEGACY_ID || busy) return;
    setBusy(true);
    setNote(null);
    const r = await actions.toggle(enabled);
    setBusy(false);
    if (!r.ok) return setNote({ kind: "switch", refused: r.refused });
    // Kept on screen until the next read: switched off, the setting is no
    // longer a derived card for the server, but the user sees what they did.
    setPage((p) => withLegacyEnabled(p, enabled));
    setHandoff(r.generated);
    setEditorKey((k) => k + 1);
    // A generated secret is shown once, in the editor's box: open it there.
    if (r.generated) openEditor();
  };

  const onTest = async (id: string) => {
    if (id !== LEGACY_ID) return;
    setNote({ kind: "test", words: "running" });
    setNote({ kind: "test", words: await actions.test() });
  };

  // After the editor saved: the page as the server now reads it (the setting
  // may have become, or stopped being, the derived card).
  const onSaved = () => {
    void actions.refresh().then((p) => {
      if (p) setPage(p);
    });
  };

  const noteNode = (n: Note | null) => {
    if (!n) return undefined;
    if (n.kind === "switch") {
      return (
        <span className="font-semibold text-[#b91c1c]">{n.refused === "disabled" ? tAgent("refused.disabled") : tTools("saveError")}</span>
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
        now={now}
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
            <button
              type="button"
              className={CLOSE}
              onClick={() => {
                setEditorOpen(false);
                setHandoff(null);
              }}
              data-editor-close
            >
              {t("closeEditor")}
            </button>
          </div>
          <ClientAgentBrick key={editorKey} asUserId={asUserId} onSaved={onSaved} initialGenerated={handoff} />
        </div>
      )}
    </div>
  );
}
