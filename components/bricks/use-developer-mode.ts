"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useDataFetch } from "@/components/preview/preview-context";

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
  // Preview (F2): the sample source (it refuses: developer mode stays off), never the network.
  const dataFetch = useDataFetch();
  useEffect(() => {
    void loadDeveloperMode(asUserId, dataFetch);
  }, [asUserId, dataFetch]);
  const set = useCallback((enabled: boolean) => setDeveloperMode(asUserId, enabled, dataFetch), [asUserId, dataFetch]);
  return { ...state, on: state.enabled === true, set };
}
