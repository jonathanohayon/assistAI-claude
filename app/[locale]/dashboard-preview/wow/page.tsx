/**
 * Preview "Voice Studio" — direction visuelle complètement différente du
 * dashboard config actuel. Aurora mesh animé + hero éditorial + bento glass
 * cards + waveform SVG. Tout est mocké, aucune logique réelle. À jeter une
 * fois le style validé.
 */
import { requireAdminOr404 } from "@/lib/auth/require-admin-page";

import { WowDashboard } from "./client";

// Admins only: gated here as well as in the layout (they render in parallel).
export default async function WowPreviewPage() {
  await requireAdminOr404();
  return <WowDashboard />;
}
