"use client";

import { useEffect, useRef, useState } from "react";
import type { Granularity } from "./types";

// ── Formatage USD ────────────────────────────────────────────────────────────
const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const usdFmtPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** "$1,234.56" — pour KPIs, axes, totaux. */
export function fmtUsd(value: number): string {
  return usdFmt.format(Number.isFinite(value) ? value : 0);
}

/** Variante précise (jusqu'à 4 décimales) — pour petits montants/tooltips. */
export function fmtUsdPrecise(value: number): string {
  return usdFmtPrecise.format(Number.isFinite(value) ? value : 0);
}

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "1.2K", "3.4M" — pour tokens/messages. */
export function fmtCompact(value: number): string {
  return compactFmt.format(Number.isFinite(value) ? value : 0);
}

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fmtInt(value: number): string {
  return intFmt.format(Number.isFinite(value) ? Math.round(value) : 0);
}

const MONTHS_FR = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
] as const;

/** Formate une période "YYYY-MM-DD" selon la granularité. */
export function formatPeriod(iso: string, granularity: Granularity): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (granularity === "day") {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }
  if (granularity === "month") {
    const yy = String(d.getUTCFullYear()).slice(-2);
    return `${MONTHS_FR[d.getUTCMonth()]} ${yy}`;
  }
  return String(d.getUTCFullYear());
}

// ── Count-up (rAF, ease-out cubic) ───────────────────────────────────────────
export function useCountUp(target: number, durationMs = 900): number {
  const [v, setV] = useState(target);
  const ref = useRef(target);
  useEffect(() => {
    const from = ref.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (target - from) * eased;
      ref.current = val;
      setV(val);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return v;
}
