// Pure diff for scripts/livekit-trunk-cleanup.ts: what the LiveKit inbound
// trunk should accept vs what it does. Unit-tested in
// scripts/tests/trunk-reconcile.test.ts.

export interface TrunkPlan {
  remove: string[];
  add: string[];
  /** null = leave allowed_addresses untouched. */
  setAllowedAddresses: string[] | null;
  noop: boolean;
}

export function planTrunk(args: {
  current: string[];
  desired: string[];
  currentAllowed: string[];
  desiredAllowed: string[] | null;
}): TrunkPlan {
  const cur = new Set(args.current);
  const want = new Set(args.desired);
  const remove = [...cur].filter((n) => !want.has(n)).sort();
  const add = [...want].filter((n) => !cur.has(n)).sort();
  let setAllowedAddresses: string[] | null = null;
  if (args.desiredAllowed) {
    const a = [...new Set(args.desiredAllowed)].sort();
    const b = [...new Set(args.currentAllowed)].sort();
    if (a.join(",") !== b.join(",")) setAllowedAddresses = a;
  }
  return {
    remove,
    add,
    setAllowedAddresses,
    noop: remove.length === 0 && add.length === 0 && setAllowedAddresses === null,
  };
}
