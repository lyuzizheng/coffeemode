"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { CheckinDrawer, CHECKIN_RESUME_PARAM } from "./checkin-drawer";
import type { PhotoUpload } from "./checkin-photos";
import {
  clearPendingCheckin,
  loadPendingCheckin,
  type PendingCheckinDraft,
} from "@/lib/checkin/pending-checkin";

/**
 * Sign-in gate resume host (DG66). The gate stages the whole draft to
 * IndexedDB before the full-page OAuth bounce and sends the user back here
 * with `?checkin_resume=1`; this host reloads the draft, reopens the drawer
 * with every input restored (staged photos upload at publish, DG59), and the
 * user publishes with one tap — no re-entry.
 *
 * Mounted once in the root layout so the bounce works from any page the
 * drawer can open on.
 */

interface CheckinResumeProps {
  /** checkins.pendingDraftTtlHours (DG107), passed from the server layout. */
  draftTtlHours: number;
}

function CheckinResumeInner({ draftTtlHours }: CheckinResumeProps) {
  const t = useTranslations("checkIn");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [draft, setDraft] = useState<PendingCheckinDraft | null>(null);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get(CHECKIN_RESUME_PARAM) !== "1") return;
    // Strip the flag first so a refresh doesn't resurrect a consumed bounce.
    router.replace(pathname, { scroll: false });
    let cancelled = false;
    void loadPendingCheckin(draftTtlHours * 3_600_000)
      .then((stored) => {
        if (cancelled || !stored) return;
        setPhotos(
          stored.photos.map((p) => {
            const restoredFile =
              p.file instanceof File
                ? p.file
                : new File([p.file], p.name || "photo.jpg", { type: p.file.type });
            return {
              id: p.id,
              previewUrl: URL.createObjectURL(p.file),
              status: p.imageUuid ? ("done" as const) : ("staged" as const),
              ...(p.imageUuid ? { imageUuid: p.imageUuid } : {}),
              file: restoredFile,
            };
          }),
        );
        setDraft(stored);
        setOpen(true);
        toast(t("draftRestored"), { timeout: 4000 });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — the bounce just lands home.
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams, pathname, router, draftTtlHours, t]);

  if (!draft) return null;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      // The draft's job is done either way: a successful publish already
      // cleared it, and closing without publishing went through the discard
      // confirm. Never let a consumed draft linger.
      // Benign: best-effort IndexedDB cleanup; storage errors in private mode must not throw.
      void clearPendingCheckin().catch(() => {});
    }
  };

  return (
    <CheckinDrawer
      isOpen={open}
      onOpenChange={handleOpenChange}
      cafeId={draft.cafeId}
      cafeName={draft.cafeName}
      initialScores={draft.scores}
      initialMaxStay={draft.maxStay}
      initialNote={draft.note}
      initialPhotos={photos}
    />
  );
}

export function CheckinResume({ draftTtlHours }: CheckinResumeProps) {
  return (
    <Suspense fallback={null}>
      <CheckinResumeInner draftTtlHours={draftTtlHours} />
    </Suspense>
  );
}
