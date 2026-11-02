"use client";

import { useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * `useReducedMotion()` is null during SSR, so deriving the first render from
 * it makes the server HTML and the client's first render differ for anyone
 * with "reduce motion" on: React throws a hydration error and re-renders the
 * whole tree on the client. This returns false on the server and during
 * hydration (the server snapshot), then the user's real preference.
 */
export function useReducedMotionAfterMount(): boolean {
  const prefers = useReducedMotion();
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return hydrated && !!prefers;
}
