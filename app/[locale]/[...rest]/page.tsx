import { notFound } from "next/navigation";

// Unknown paths under a valid locale (/fr/does-not-exist) would otherwise not
// enter the [locale] root layout and get Next's bare default 404. Matching them
// here renders app/[locale]/not-found.tsx inside the localized layout, with
// the right lang/dir and styles. Real routes are more specific and win.
export default function CatchAllNotFound() {
  notFound();
}
