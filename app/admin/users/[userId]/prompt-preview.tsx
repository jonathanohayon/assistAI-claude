"use client";

import Link from "next/link";
import { useState } from "react";

import type { PromptBlock } from "@/lib/agent-prompt-preview";

/**
 * Affiche bloc par bloc le system prompt qui sera assemblé pour l'agent
 * au prochain appel de ce tenant. Lecture seule — chaque bloc indique sa
 * source (DB/code worker) et un lien d'édition quand pertinent.
 *
 * UX :
 *   - Header replié par défaut (le prompt fait facilement 5000+ chars
 *     une fois tous les blocs concaténés, pas la peine d'ouvrir tout
 *     visible).
 *   - Clic sur un bloc → expand/collapse de son contenu en pre.
 *   - Bouton "Voir le prompt concaténé" → modal-like overlay avec tout
 *     le merge final, pratique pour copier ou comparer.
 */
export function PromptPreview({
  blocks,
  fullPrompt,
}: {
  blocks: PromptBlock[];
  fullPrompt: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState<"all" | string | null>(null);

  const copyToClipboard = async (text: string, key: "all" | string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // fallback en cas de denied clipboard
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        // tant pis
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalChars = blocks.reduce((sum, b) => sum + b.content.length, 0);

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight text-[var(--color-foreground)]">
            Prompt complet envoyé à l&apos;agent
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Vue d&apos;ensemble des {blocks.length} blocs assemblés dans le
            system prompt OpenAI Realtime à chaque appel. {totalChars} chars total.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyToClipboard(fullPrompt, "all")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              copied === "all"
                ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-[var(--color-primary)] text-white hover:opacity-90"
            }`}
            title="Copie le prompt complet (tous les blocs concaténés) au format final envoyé à l'agent"
          >
            {copied === "all" ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Copié !
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copier prompt complet ({fullPrompt.length} chars)
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowFull((v) => !v)}
            className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
          >
            {showFull ? "Masquer le concat" : "Voir tout concaténé"}
          </button>
          <button
            type="button"
            onClick={() => {
              const all = new Set(blocks.map((b) => b.id));
              setExpanded(expanded.size === all.size ? new Set() : all);
            }}
            className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
          >
            {expanded.size === blocks.length ? "Tout replier" : "Tout déplier"}
          </button>
        </div>
      </div>

      {showFull && (
        <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
              Concaténation finale ({fullPrompt.length} chars)
            </p>
            <button
              type="button"
              onClick={() => copyToClipboard(fullPrompt, "all")}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                copied === "all"
                  ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-white text-[var(--color-foreground)] ring-1 ring-[var(--color-border)] hover:bg-[var(--color-muted)]"
              }`}
            >
              {copied === "all" ? "✓ Copié" : "📋 Copier"}
            </button>
          </div>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]">
            {fullPrompt}
          </pre>
        </div>
      )}

      <ul className="mt-5 space-y-2">
        {blocks.map((b) => {
          const isOpen = expanded.has(b.id);
          return (
            <li
              key={b.id}
              className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white"
            >
              <button
                type="button"
                onClick={() => toggle(b.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-muted)]/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-[var(--color-foreground)]">
                      {b.label}
                    </span>
                    <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">
                      {b.content.length} chars
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    Source : <code className="font-mono">{b.source}</code>
                    {b.editHref && (
                      <>
                        {" · "}
                        {b.editHref.startsWith("/") ? (
                          <Link
                            href={b.editHref}
                            className="text-[var(--color-primary)] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Éditer →
                          </Link>
                        ) : (
                          <a
                            href={b.editHref}
                            className="text-[var(--color-primary)] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Éditer dans le formulaire ci-dessous
                          </a>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {isOpen ? "▼" : "▶"}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-[var(--color-border)] bg-[var(--color-muted)]/30">
                  <div className="flex items-center justify-end px-4 pt-2">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(b.content, b.id)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                        copied === b.id
                          ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                          : "bg-white text-[var(--color-foreground)] ring-1 ring-[var(--color-border)] hover:bg-[var(--color-muted)]"
                      }`}
                    >
                      {copied === b.id ? "✓ Copié" : "📋 Copier ce bloc"}
                    </button>
                  </div>
                  <pre className="max-h-[40vh] overflow-auto px-4 pb-3 pt-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--color-foreground)]">
                    {b.content}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
