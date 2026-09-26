"use client";

import { Suspense, useEffect, useRef, useState } from "react";
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

function restorePhotos(photos: PendingCheckinDraft["photos"]): PhotoUpload[] {
  return photos.map((p) => {
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
  });
}

function getCleanResumeUrl(pathname: string, searchParams: { toString(): string }): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete(CHECKIN_RESUME_PARAM);
  const remainingQuery = params.toString();
  return remainingQuery ? `${pathname}?${remainingQuery}` : pathname;
}

function useCheckinResume(draftTtlHours: number) {
  const t = useTranslations("checkIn");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [draft, setDraft] = useState<PendingCheckinDraft | null>(null);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const [open, setOpen] = useState(false);

  // Active recovery operation handle. Survives URL parameter cleanup on the
  // same pathname, but is cancelled if the component unmounts or navigates away.
  const activeRecoveryRef = useRef<{
    pathname: string;
    cancelled: boolean;
  } | null>(null);

  // Tracks the last processed trigger URL to prevent duplicate reads or replacements
  // when re-rendering before the router replacement updates searchParams.
  const lastProcessedTriggerRef = useRef<string | null>(null);

  // Cancel any in-flight recovery on unmount or navigation away (pathname change).
  useEffect(() => {
    return () => {
      if (activeRecoveryRef.current) {
        activeRecoveryRef.current.cancelled = true;
        activeRecoveryRef.current = null;
      }
    };
  }, [pathname]);

  useEffect(() => {
    if (searchParams.get(CHECKIN_RESUME_PARAM) !== "1") {
      lastProcessedTriggerRef.current = null;
      return;
    }

    const triggerKey = `${pathname}?${searchParams.toString()}`;
    if (lastProcessedTriggerRef.current === triggerKey) {
      return;
    }
    lastProcessedTriggerRef.current = triggerKey;

    if (activeRecoveryRef.current) {
      activeRecoveryRef.current.cancelled = true;
    }

    const recovery = { pathname, cancelled: false };
    activeRecoveryRef.current = recovery;

    // Strip the flag first so a refresh doesn't resurrect a consumed bounce.
    router.replace(getCleanResumeUrl(pathname, searchParams), { scroll: false });

    void loadPendingCheckin(draftTtlHours * 3_600_000)
      .then((stored) => {
        if (recovery.cancelled || !stored) return;
        setPhotos(restorePhotos(stored.photos));
        setDraft(stored);
        setOpen(true);
        toast(t("draftRestored"), { timeout: 4000 });
      })
      .catch(() => {
        // IndexedDB unavailable (private mode) — the bounce just lands home.
      });
  }, [searchParams, pathname, router, draftTtlHours, t]);

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

  return { draft, photos, open, handleOpenChange };
}

function CheckinResumeInner({ draftTtlHours }: CheckinResumeProps) {
  const { draft, photos, open, handleOpenChange } = useCheckinResume(draftTtlHours);

  if (!draft) return null;

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
