"use client";

import { useNetworkStatus } from "@/hooks/use-network-status";

export function OfflineBanner() {
  const { isOffline } = useNetworkStatus();

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="safe-area-inset-top fixed left-0 right-0 top-0 z-50 bg-warning px-4 py-2 text-center text-sm font-medium text-warning-foreground"
    >
      Connection is unstable — some info may be outdated.
    </div>
  );
}
