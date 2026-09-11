"use client";

import { useCallback, useState } from "react";
import type { PhotoUpload } from "./checkin-photos";
import { uploadPhoto } from "@/lib/images/client-upload";

export function useStagedPhotos(initialPhotos?: PhotoUpload[]) {
  const [photos, setPhotos] = useState<PhotoUpload[]>(initialPhotos ?? []);

  const uploadPendingPhotos = useCallback(async (): Promise<string[]> => {
    const hasUploading = photos.some((p) => p.status === "uploading");
    if (hasUploading) throw new Error("photos_uploading");

    // Staged photos (logged-out composer, DG59) upload now, at publish
    // time — presigned URLs are issued to authenticated sessions only.
    // Previously failed tiles still hold their File and retry here too.
    const pendingUploads = photos.filter((p): p is PhotoUpload & { file: File } => p.file !== undefined && !p.imageUuid);
    const justUploaded = new Map<string, string>();

    if (pendingUploads.length > 0) {
      const failedIds = new Set<string>();
      let unauthorized = false;
      await Promise.all(
        pendingUploads.map(async (p) => {
          try {
            justUploaded.set(p.id, await uploadPhoto(p.file));
          } catch (err) {
            // A 401 is a session problem, not a photo problem: per-photo
            // retry can never succeed, so escalate to the sign-in gate
            // instead of marking the tile failed.
            if (err instanceof Error && err.message === "unauthorized") {
              unauthorized = true;
              return;
            }
            failedIds.add(p.id);
          }
        }),
      );

      // Write every successful upload back into state before anything can
      // fail: a retry (failed photos or a failed POST) must reuse these
      // ids, not re-upload and orphan the first batch in R2.
      setPhotos((prev) =>
        prev.map((p) => {
          const uuid = justUploaded.get(p.id);
          if (uuid) return { ...p, status: "done", imageUuid: uuid };
          if (failedIds.has(p.id)) return { ...p, status: "error" as const };
          return p;
        }),
      );

      // Session expiry dominates: the mutation's onError routes this to
      // onRequireSignIn, which stages the draft and opens the gate.
      if (unauthorized) throw new Error("unauthorized");
      if (failedIds.size > 0) {
        throw new Error("photo_upload_failed");
      }
    }

    return photos
      .map((p) => p.imageUuid ?? justUploaded.get(p.id))
      .filter((id): id is string => Boolean(id));
  }, [photos]);

  return {
    photos,
    setPhotos,
    uploadPendingPhotos,
  };
}
