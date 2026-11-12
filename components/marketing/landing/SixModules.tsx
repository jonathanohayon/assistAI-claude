import type { ReactNode } from "react";

import type { ModuleId, ModulesCopy } from "@/lib/marketing/home-content";

import { Stagger, StaggerItem } from "../Reveal";
import { SectionHeader } from "./SectionHeader";

/** One stroke glyph per module (24×24, currentColor). */
const GLYPHS: Record<ModuleId, ReactNode> = {
  // Voice: a sound wave.
  voice: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  // Persona: a face.
  persona: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  // Knowledge: an open book.
  knowledge: <path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z" />,
  // Tools: a wrench.
  tools: <path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z" />,
  // Channels: a phone handset.
  channels: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  // Mission: a target.
  mission: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
};

/**
 * The six modules every Tamara agent is assembled from, one line each.
 * Shared by the landing pages. One panel split by hairlines (a build sheet),
 * not six floating cards.
 */
export function SixModules({ items, ...heading }: ModulesCopy) {
  return (
    <section id="modules" aria-labelledby="modules-title" className="relative bg-white py-24 sm:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 45% at 10% 20%, rgba(190,24,93,0.06) 0%, transparent 70%), radial-gradient(45% 40% at 90% 85%, rgba(34,211,238,0.08) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-6">
        <SectionHeader heading={heading} id="modules-title" />
        <Stagger className="mt-14 overflow-hidden rounded-[2rem] border border-[#22d3ee]/35 bg-[#e2e8f0] shadow-[0_24px_64px_-32px_rgba(14,116,144,0.35)]">
          <ul className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3">
            {items.map((m) => (
              <li key={m.id} className="bg-white">
                <StaggerItem className="flex h-full items-start gap-4 p-6 sm:p-8">
                  <span
                    aria-hidden
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#be185d] to-[#db2777] text-white ring-2 ring-[#22d3ee]/40"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-6 w-6"
                    >
                      {GLYPHS[m.id]}
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-2xl tracking-tight text-[#18181b]">{m.title}</h3>
                    <p className="mt-1.5 text-base leading-relaxed text-[#475569]">{m.body}</p>
                  </div>
                </StaggerItem>
              </li>
            ))}
          </ul>
        </Stagger>
      </div>
    </section>
  );
}
