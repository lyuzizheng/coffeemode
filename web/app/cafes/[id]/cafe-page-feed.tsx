"use client";

/**
 * Part 2 of the SSR cafe page (DG106): the check-in feed loads client-side
 * from the public paginated API after paint — user content never appears in
 * the initial HTML. Reuses the discovery feed component unchanged: Newest
 * default (DG113), cursor pagination, stale-while-revalidate (DG17).
 */
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "@heroui/react";
import { CheckinFeed } from "@/components/discovery/checkin-feed";

export function CafePageFeed({ cafeId }: { cafeId: string }) {
  const t = useTranslations("discovery");
  const router = useRouter();
  return (
    <CheckinFeed
      cafeId={cafeId}
      // A feed 404 means the cafe vanished after the shell rendered; the
      // server owns the 404 surface (DG19), so re-fetch this route.
      onMissingCafe={() => router.refresh()}
      // Interim: the drawer arrives with the checkin-system slice.
      onCheckIn={() => toast(t("checkin_coming"), { timeout: 4000 })}
    />
  );
}
