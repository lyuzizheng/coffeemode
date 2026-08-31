"use client";

/**
 * Part 2 of the SSR cafe page (DG106): the check-in feed loads client-side
 * from the public paginated API after paint — user content never appears in
 * the initial HTML. Reuses the discovery feed component unchanged: Newest
 * default (DG113), cursor pagination, stale-while-revalidate (DG17).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckinFeed } from "@/components/discovery/checkin-feed";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";

export function CafePageFeed({ cafeId, cafeName }: { cafeId: string; cafeName: string }) {
  const router = useRouter();
  const [checkinOpen, setCheckinOpen] = useState(false);
  return (
    <>
      <CheckinFeed
        cafeId={cafeId}
        // A feed 404 means the cafe vanished after the shell rendered; the
        // server owns the 404 surface (DG19), so re-fetch this route.
        onMissingCafe={() => router.refresh()}
        onCheckIn={() => setCheckinOpen(true)}
      />
      {/* Same auth story as CafePageActions: cached public shell, so the
          drawer resolves auth client-side. */}
      <CheckinDrawer isOpen={checkinOpen} onOpenChange={setCheckinOpen} cafeId={cafeId} cafeName={cafeName} />
    </>
  );
}
