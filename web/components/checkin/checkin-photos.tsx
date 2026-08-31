"use client";

import { useCallback, useRef } from "react";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { uploadPhoto } from "@/lib/images/client-upload";

export interface PhotoUpload {
  id: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  imageUuid?: string;
}

interface CheckinPhotosProps {
  photos: PhotoUpload[];
  onChange: React.Dispatch<React.SetStateAction<PhotoUpload[]>>;
  maxPhotos?: number;
  disabled?: boolean;
}

export function CheckinPhotos({ photos, onChange, maxPhotos = 6, disabled = false }: CheckinPhotosProps) {
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

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || disabled) return;
      const remaining = maxPhotos - photos.length;
      const toUpload = Array.from(files).slice(0, remaining);
      if (toUpload.length === 0) return;

      const mappedEntries: PhotoUpload[] = toUpload.map((file) => ({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        previewUrl: URL.createObjectURL(file),
        status: "uploading" as const,
      }));

      // Functional updates throughout: uploads resolve asynchronously, and a
      // stale `photos` snapshot would clobber entries added mid-flight or
      // resurrect removed ones.
      onChange((prev) => [...prev, ...mappedEntries]);

      const updateEntry = (id: string, patch: Partial<PhotoUpload>) => {
        onChange((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      };

      await Promise.all(
        toUpload.map(async (file, idx) => {
          const id = mappedEntries[idx].id;
          try {
            const imageUuid = await uploadPhoto(file);
            updateEntry(id, { status: "done", imageUuid });
          } catch {
            updateEntry(id, { status: "error" });
          }
        }),
      );
      if (inputRef.current) inputRef.current.value = "";
    },
    [photos.length, maxPhotos, disabled, onChange],
  );

  const removePhoto = (id: string) => {
    const target = photos.find((p) => p.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange((prev) => prev.filter((p) => p.id !== id));
  };

  const retryPhoto = (id: string) => {
    removePhoto(id);
    inputRef.current?.click();
  };

  const canAdd = photos.length < maxPhotos && !disabled;

  return (
    <div className="flex gap-2 overflow-x-auto py-1">
      {photos.map((photo) => (
        <div
          key={photo.id}
          className={`relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border bg-surface-secondary ${
            photo.status === "error" ? "border-danger" : "border-border"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
          <button
            type="button"
            aria-label={t("removePhoto")}
            onClick={() => removePhoto(photo.id)}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-overlay text-white hover:bg-black/60"
          >
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden>
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
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
