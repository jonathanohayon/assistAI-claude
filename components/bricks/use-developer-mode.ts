"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getDeveloperMode,
  loadDeveloperMode,
  setDeveloperMode,
  subscribeDeveloperMode,
  type DeveloperModeState,
} from "./developer-mode-store";

const SERVER_STATE: DeveloperModeState = { enabled: null, saving: false, error: null };

/** Account developer mode for the current tenant (or `asUserId` for admins). */
export function useDeveloperMode(asUserId?: string | null) {
  const state = useSyncExternalStore(
    useCallback((l: () => void) => subscribeDeveloperMode(asUserId, l), [asUserId]),
    () => getDeveloperMode(asUserId),
    () => SERVER_STATE,
  );
  useEffect(() => {
    void loadDeveloperMode(asUserId);
  }, [asUserId]);
  const set = useCallback((enabled: boolean) => setDeveloperMode(asUserId, enabled), [asUserId]);
  return { ...state, on: state.enabled === true, set };
}
