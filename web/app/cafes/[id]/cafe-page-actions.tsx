"use client";

/**
 * Action block for the SSR cafe page (DG109 — this page's job is conversion):
 * the dominant full-width 56px Check-in CTA, with Navigate and Share visually
 * subordinate below it. The check-in drawer is the checkin-system slice.
 *
 * DG72 entry point: when the viewer has a live check-in at this cafe, a
 * quiet "Edit your check-in" row sits under the actions and opens the same
 * drawer in edit mode, prefilled. This shell is CDN-cached (DG105/DG106),
 * so live-check-in detection is a client-side /api/checkins/last probe —
 * anonymous viewers 401 and simply never see the row. Same query key as the
 * drawer's DG64 probe, so both share one network call.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { PencilIcon } from "@/components/icons";
import { ShareControl } from "@/components/share/share-control";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import { fetchLastCheckin, type LastCheckin } from "@/lib/checkin/last-checkin";
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
  const tCheckin = useTranslations("checkIn");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LastCheckin | null>(null);

  // No isAuthenticated prop anywhere on this page (cached public shell), so
  // the probe doubles as the auth signal: 401 resolves to "no row".
  const liveCheckinQuery = useQuery({
    queryKey: ["last-checkin", cafeId],
    queryFn: () => fetchLastCheckin(cafeId),
    staleTime: 60_000,
    retry: false,
  });
  const liveCheckin = liveCheckinQuery.data?.checkin ?? null;

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
        {liveCheckin && (
          <button
            type="button"
            onClick={() => setEditing(liveCheckin)}
            className="mx-auto flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm text-muted transition-colors hover:text-foreground"
          >
            <PencilIcon size={13} />
            {tCheckin("editYourCheckIn")}
          </button>
        )}
      </div>
      {/* No isAuthenticated prop here: this page is the CDN-cached public shell
          (DG105/DG106), so per-user auth can't be baked into the HTML. The
          drawer resolves auth client-side via its last-check-in probe and
          drops to the sign-in gate on 401. */}
      <CheckinDrawer isOpen={open} onOpenChange={setOpen} cafeId={cafeId} cafeName={cafe.name} />
      {editing && (
        <CheckinDrawer
          isOpen
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditing(null);
          }}
          cafeId={cafeId}
          cafeName={cafe.name}
          mode="edit"
          editCheckinId={editing.id}
          initialScores={editing.scores}
          initialMaxStay={editing.max_stay}
          initialNote={editing.note}
        />
      )}
    </>
  );
}
