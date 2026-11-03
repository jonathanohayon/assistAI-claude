"use client";

/**
 * "i" info tooltip, placed next to a setting's label.
 *
 * - Opens on hover (mouse), tap (touch), and keyboard focus; closes on
 *   Escape, outside tap, blur, and mouse leave (when opened by hover).
 * - The text is ALWAYS in the DOM (visually hidden while closed), so the
 *   setting's control can point at it with `aria-describedby={tipId}` and
 *   screen readers read it whether or not the bubble is open.
 * - RTL-safe: logical positioning, and the bubble is shifted to stay inside
 *   the viewport on phones.
 *
 * Usage:
 *   const tipId = useId();
 *   <label>Turn sensitivity <InfoTip id={tipId} label="…" what="…" tip="…" meta="…" /></label>
 *   <input aria-describedby={tipId} … />
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

const VIEWPORT_GUTTER = 12;

export function InfoTip({ id, label, what, tip, meta }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const openedByHover = useRef(false);
  // A tap/click fires focus THEN click: let the click decide, or the focus
  // would open it and the click immediately close it again.
  const pointerPress = useRef(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);

  const close = useCallback(() => {
    openedByHover.current = false;
    setOpen(false);
  }, []);

  // Keep the bubble inside the viewport (phones, and RTL where it opens
  // towards the left). Measured after it renders open.
  useLayoutEffect(() => {
    if (!open || !bubbleRef.current) {
      setShift(0);
      return;
    }
    const r = bubbleRef.current.getBoundingClientRect();
    const maxRight = window.innerWidth - VIEWPORT_GUTTER;
    if (r.right > maxRight) setShift(maxRight - r.right);
    else if (r.left < VIEWPORT_GUTTER) setShift(VIEWPORT_GUTTER - r.left);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

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
        if (e.pointerType === "mouse" && openedByHover.current) close();
      }}
    >
      <button
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
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        style={open && shift ? { transform: `translateX(${shift}px)` } : undefined}
        className={
          open
            ? "absolute start-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[#e2e8f0] bg-white p-3 text-start text-[12px] font-normal normal-case leading-snug tracking-normal text-[#334155] shadow-lg"
            : "sr-only"
        }
      >
        <span className="block">{what}</span>
        {tip && <span className="mt-1.5 block text-[#0f172a]">💡 {tip}</span>}
        {meta && <span className="mt-1.5 block text-[11px] text-[#64748b]">{meta}</span>}
      </span>
    </span>
  );
}
