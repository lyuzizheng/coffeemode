"use client";

/**
 * Action block for the SSR cafe page (DG109 — this page's job is conversion):
 * the dominant full-width 56px Check-in CTA, with Navigate and Share visually
 * subordinate below it.
 *
 * Interim: the check-in composer is the checkin-system slice's drawer, so the
 * CTA explains itself instead of being a dead button — the same contract the
 * discovery sheet uses until that slice lands.
 */
import { useTranslations } from "next-intl";
import { Button, toast } from "@heroui/react";
import { ShareControl } from "@/components/share/share-control";
import type { CafeDetail } from "@/types/cafes";

export function CafePageActions({
  cafe,
  shareUrl,
}: {
  cafe: Pick<CafeDetail, "name" | "lat" | "lng">;
  /** Absolute canonical page URL for sharing. */
  shareUrl: string;
}) {
  const t = useTranslations("discovery");
  const handleCheckIn = () => toast(t("checkin_coming"), { timeout: 4000 });
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" className="h-14 w-full rounded-sm text-base" onPress={handleCheckIn}>
        {t("check_in")}
      </Button>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onPress={() =>
            window.open(
              `https://www.google.com/maps/dir/?api=1&destination=${cafe.lat},${cafe.lng}`,
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          {t("navigate")}
        </Button>
        <ShareControl url={shareUrl} title={cafe.name} />
      </div>
    </div>
  );
}
