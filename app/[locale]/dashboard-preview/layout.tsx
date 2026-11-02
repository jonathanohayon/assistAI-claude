import { FullMessagesProvider } from "@/components/i18n/FullMessagesProvider";

// Mock dashboard: same client components as /dashboard, so same full set of
// translations (public pages only ship i18n/public-namespaces).
export default function DashboardPreviewLayout({ children }: { children: React.ReactNode }) {
  return <FullMessagesProvider>{children}</FullMessagesProvider>;
}
