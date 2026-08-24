import Image from "next/image";
import type { StoredImage } from "@/types/images";

/**
 * Horizontal gallery thumbnail strip. Shared by the discovery FULL detail
 * and the SSR cafe page shell — same 72px thumbs, same order (artifact §2).
 * Props are the public-safe slice of a stored image: the SSR page renders
 * this into the RSC payload, which must never carry internal author
 * identifiers (`StoredImage.by` — DG13).
 */
export function GalleryStrip({
  photos,
  ariaLabel,
}: {
  photos: Pick<StoredImage, "id" | "thumbnail">[];
  ariaLabel: string;
}) {
  if (photos.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto" aria-label={ariaLabel}>
      {photos.map((photo) => (
        <span
          key={photo.id}
          className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-separator bg-surface-tertiary"
        >
          <Image src={photo.thumbnail} alt="" fill sizes="72px" className="object-cover" />
        </span>
      ))}
    </div>
  );
}
