// Which per-product trial caps are ENFORCED (P3). A product's trial is
// startable only when its cap is (lib/product-trials.ts productTrialStartable).
//   - sales: enforced by the campaign dispatcher (lib/campaigns/dispatch.ts →
//     lib/campaigns/sales-trial-cap.ts), so it reads that module's constant.
//   - reception, reception_multi, connect: their minutes are spent answering
//     calls; the cap at call answering (lib/agent/session-config/trial-gate.ts
//     / inbound.ts + the worker) is HELD, so they stay false.
import { SALES_TRIAL_CAP_ENFORCED } from "./campaigns/sales-trial-cap";
import type { TrialCaps } from "./product-trials";

export const TRIAL_CAPS_ENFORCED: TrialCaps = {
  reception: false,
  reception_multi: false,
  sales: SALES_TRIAL_CAP_ENFORCED,
  connect: false,
};
