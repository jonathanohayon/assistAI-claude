"use client";

/**
 * "i" info tooltip, placed next to a setting's label.
 *
 * - Opens on hover (real mouse only), tap (touch), and keyboard focus;
 *   closes on Escape, outside tap, blur, scroll/resize, and mouse leave
 *   (when opened by hover). A click on a hover-opened tip pins it open.
 * - The text is ALWAYS in the DOM, visually hidden, next to the button
 *   (`id`), so the setting's control can use `aria-describedby={id}` and
 *   screen readers read it whether or not the bubble is open.
 * - The visible bubble is rendered in a portal on document.body with fixed
 *   positioning: settings panels clip overflow (and transform/blur create
 *   containing blocks), so an in-place bubble got cut off. It anchors to the
 *   button's inline-start edge (left in LTR, right in RTL) and is clamped to
 *   the viewport.
 *
 * Usage:
 *   const tipId = useId();
 *   <label>Turn sensitivity <InfoTip id={tipId} label="…" what="…" tip="…" meta="…" /></label>
 *   <input aria-describedby={tipId} … />
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type InfoTipProps = {
  /** id of the description element; pass it to the control's aria-describedby. */
  id: string;
  /** Accessible name of the "i" button, e.g. "About turn sensitivity". */
  label: string;
  /** What the setting does. */
  what: string;
  /** How to use it, with a concrete tip. */
  tip?: string;
  /** Range / default / supported engines, one short line. */
  meta?: string;
};

const GUTTER = 12;
const BUBBLE_WIDTH = 288; // w-72

type Pos = { top: number; left: number; width: number; rtl: boolean };

export function InfoTip({ id, label, what, tip, meta }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const openedByHover = useRef(false);
  // A tap/click fires focus THEN click: let the click decide, or the focus
  // would open it and the click immediately close it again.
  const pointerPress = useRef(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    openedByHover.current = false;
    setOpen(false);
  }, []);

  // Position from the button, clamped to the viewport, RTL-aware.
  const place = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const rtl = getComputedStyle(btn).direction === "rtl";
    const vw = window.innerWidth;
    const width = Math.min(BUBBLE_WIDTH, vw - 2 * GUTTER);
    let left = rtl ? r.right - width : r.left;
    left = Math.max(GUTTER, Math.min(left, vw - GUTTER - width));
    setPos({ top: r.bottom + 6, left, width, rtl });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || bubbleRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  const body = (
    <>
      <span className="block">{what}</span>
      {tip && <span className="mt-1.5 block text-[#0f172a]">💡 {tip}</span>}
      {meta && <span className="mt-1.5 block text-[11px] text-[#64748b]">{meta}</span>}
    </>
  );

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex align-middle"
      // Hover is for real mice only: touch browsers fire emulated mouse
      // enter/leave around a tap, which would open and instantly close it.
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse" && !open) {
          openedByHover.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || !openedByHover.current) return;
        // Moving onto the bubble keeps it open.
        if (bubbleRef.current?.contains(e.relatedTarget as Node)) return;
        close();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={id}
        onPointerDown={() => {
          pointerPress.current = true;
        }}
        onClick={(e) => {
          e.preventDefault(); // inside a <label>: don't toggle the control
          pointerPress.current = false;
          if (openedByHover.current) {
            // Opened by hovering: a click pins it open instead of closing it.
            openedByHover.current = false;
            setOpen(true);
            return;
          }
          setOpen((v) => !v);
        }}
        onFocus={() => {
          if (!pointerPress.current) setOpen(true); // keyboard focus
        }}
        onBlur={close}
        className="ms-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#94a3b8] text-[10px] font-bold leading-none text-[#475569] transition-colors hover:border-[#0e7490] hover:text-[#0e7490] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490]/40"
      >
        <span aria-hidden>i</span>
      </button>

      {/* Always present for assistive tech (aria-describedby target). */}
      <span id={id} role="tooltip" className="sr-only">
        {body}
      </span>

      {open &&
        pos &&
        createPortal(
          <div
            ref={bubbleRef}
            aria-hidden
            dir={pos.rtl ? "rtl" : "ltr"}
            onPointerLeave={(e) => {
              if (e.pointerType !== "mouse" || !openedByHover.current) return;
              if (wrapRef.current?.contains(e.relatedTarget as Node)) return;
              close();
            }}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
            data-infotip-for={id}
            className="z-[100] rounded-xl border border-[#e2e8f0] bg-white p-3 text-start text-[12px] font-normal normal-case leading-snug tracking-normal text-[#334155] shadow-lg"
          >
            {body}
          </div>,
          document.body,
        )}
    </span>
  );
}
