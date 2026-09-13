"use client";

import { useCallback, useRef } from "react";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { isUnauthorized } from "@/lib/http";
import { uploadPhoto } from "@/lib/images/client-upload";

export interface PhotoUpload {
  id: string;
  previewUrl: string;
  /** "staged" = held locally (logged-out composer, DG59); uploads at publish time. */
  status: "staged" | "uploading" | "done" | "error";
  imageUuid?: string;
  /** Original file, retained so a staged photo can upload later and so the
      sign-in gate draft (DG66) can carry it through the OAuth bounce. */
  file?: File;
}

interface CheckinPhotosProps {
  photos: PhotoUpload[];
  onChange: React.Dispatch<React.SetStateAction<PhotoUpload[]>>;
  maxPhotos?: number;
  disabled?: boolean;
  /** When true (auth not confirmed), stage selections locally instead of
      starting the presigned upload — anonymous sessions get a 401 (DG59). */
  deferUpload?: boolean;
  /** An upload was rejected with 401: the session is gone, so the caller opens
      the sign-in gate instead of letting the tile pretend retry can help. */
  onRequireSignIn?: () => void;
}

export function CheckinPhotos({
  photos,
  onChange,
  maxPhotos = 6,
  disabled = false,
  deferUpload = false,
  onRequireSignIn,
}: CheckinPhotosProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("checkIn");

  // Revoke every outstanding object URL on unmount — removal revokes eagerly,
  // but a drawer close mid-draft would otherwise leak them until navigation.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const updateEntry = useCallback(
    (id: string, patch: Partial<PhotoUpload>) => {
      onChange((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [onChange],
  );

  /**
   * A 401 is a session problem, not a photo problem: no retry can succeed.
   * Return the tile to `staged` — it keeps its File, so the publish-time upload
   * after sign-in still carries it — and raise the gate instead of a tile error
   * the user can only retry into the same failure (BRAWUKA-212).
   */
  const markUploadFailure = useCallback(
    (id: string, cause: unknown) => {
      if (isUnauthorized(cause)) {
        updateEntry(id, { status: "staged" });
        onRequireSignIn?.();
        return;
      }
      updateEntry(id, { status: "error" });
    },
    [updateEntry, onRequireSignIn],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || disabled) return;
      const remaining = maxPhotos - photos.length;
      const toUpload = Array.from(files).slice(0, remaining);
      if (toUpload.length === 0) return;

      const mappedEntries: PhotoUpload[] = toUpload.map((file) => ({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        previewUrl: URL.createObjectURL(file),
        status: deferUpload ? ("staged" as const) : ("uploading" as const),
        file,
      }));

      // Functional updates throughout: uploads resolve asynchronously, and a
      // stale `photos` snapshot would clobber entries added mid-flight or
      // resurrect removed ones.
      onChange((prev) => [...prev, ...mappedEntries]);

      // Staged photos (logged-out composer) upload later, at publish time.
      if (deferUpload) {
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      await Promise.all(
        toUpload.map(async (file, idx) => {
          const id = mappedEntries[idx].id;
          try {
            const imageUuid = await uploadPhoto(file);
            updateEntry(id, { status: "done", imageUuid });
          } catch (cause) {
            markUploadFailure(id, cause);
          }
        }),
      );
      if (inputRef.current) inputRef.current.value = "";
    },
    [photos.length, maxPhotos, disabled, deferUpload, onChange, updateEntry, markUploadFailure],
  );

  const removePhoto = (id: string) => {
    const target = photos.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange((prev) => prev.filter((p) => p.id !== id));
  };

  const retryPhoto = (id: string) => {
    const target = photos.find((p) => p.id === id);
    // A failed staged photo still holds its File — re-upload in place instead
    // of making the user re-pick it.
    if (target?.file && !deferUpload) {
      updateEntry(id, { status: "uploading" });
      uploadPhoto(target.file)
        .then((imageUuid) => updateEntry(id, { status: "done", imageUuid }))
        .catch((cause) => markUploadFailure(id, cause));
      return;
    }
    removePhoto(id);
    inputRef.current?.click();
  };

  const canAdd = photos.length < maxPhotos && !disabled;

  return (
    <div className="flex gap-2 overflow-x-auto px-1 py-3">
      {photos.map((photo) => (
        <div key={photo.id} className="relative h-[72px] w-[72px] shrink-0">
          <div
            className={`h-full w-full overflow-hidden rounded-md border bg-surface-secondary ${
              photo.status === "error" ? "border-danger" : "border-border"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Local blob URL (URL.createObjectURL) for unuploaded draft preview; Next.js Image loader does not process in-memory client blob URLs */}
            <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />
            {photo.status === "uploading" && (
              <div className="absolute inset-0 bg-black/40">
                <div className="absolute bottom-0 left-0 h-0.5 w-full bg-accent/30">
                  <div className="h-full w-2/3 animate-pulse bg-accent" />
                </div>
              </div>
            )}
            {photo.status === "error" && (
              <button
                type="button"
                onClick={() => retryPhoto(photo.id)}
                className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white"
              >
                {t("retry")}
              </button>
            )}
          </div>
          {/* 44px hit box overhangs the top edge so it never covers the retry
              overlay's label (thumb center); the painted disc stays at the
              thumb's top-right corner. */}
          <button
            type="button"
            aria-label={t("removePhoto")}
            onClick={() => removePhoto(photo.id)}
            className="absolute -right-1 -top-5 h-11 w-11"
          >
            <span className="absolute right-2 top-6 flex h-5 w-5 items-center justify-center rounded-full bg-overlay text-white hover:bg-black/60">
              <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </span>
          </button>
        </div>
      ))}

      {canAdd && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface-secondary text-muted hover:bg-surface-tertiary"
          aria-label={t("addPhotos")}
        >
          <span className="text-lg leading-none">+</span>
          <span className="text-xs">{t("addPhotos")}</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
    </div>
  );
}
