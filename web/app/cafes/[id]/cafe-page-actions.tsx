"use client";

/**
 * Action block for the SSR cafe page (DG109 — this page's job is conversion):
 * the dominant full-width 56px Check-in CTA, with Navigate and Share visually
 * subordinate below it. The check-in drawer is the checkin-system slice.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { ShareControl } from "@/components/share/share-control";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import type { CafeDetail } from "@/types/cafes";

export function CafePageActions({
  cafe,
  cafeId,
  shareUrl,
}: {
  cafe: Pick<CafeDetail, "name" | "lat" | "lng">;
  cafeId: string;
  shareUrl: string;
}) {
  const t = useTranslations("discovery");
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-2">
        <Button variant="primary" className="h-14 w-full rounded-sm text-base" onPress={() => setOpen(true)}>
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
      {/* No isAuthenticated prop here: this page is the CDN-cached public shell
          (DG105/DG106), so per-user auth can't be baked into the HTML. The
          drawer resolves auth client-side via its last-check-in probe and
          drops to the sign-in gate on 401. */}
      <CheckinDrawer isOpen={open} onOpenChange={setOpen} cafeId={cafeId} cafeName={cafe.name} />
    </>
  );
}
