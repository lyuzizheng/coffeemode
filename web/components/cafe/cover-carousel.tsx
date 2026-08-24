"use client";

/**
 * 16:9 cover carousel with page dots; omitted entirely when no photos.
 * Shared by the discovery sheet (HALF) and the SSR cafe page (artifact §2).
 */
import { useRef, useState } from "react";
import Image from "next/image";

export function CoverCarousel({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  if (images.length === 0) return null;
  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-md md:max-h-[360px]"
      >
        {images.map((src, i) => (
          <div
            key={src}
            className="relative aspect-video w-full shrink-0 snap-center overflow-hidden rounded-md border border-separator bg-surface-tertiary"
          >
            <Image
              src={src}
              alt={i === 0 ? alt : ""}
              fill
              sizes="(min-width: 1024px) 400px, 100vw"
              className="object-cover"
              priority={i === 0}
            />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
          {images.map((src, i) => (
            <span
              key={src}
              className={`h-[3px] w-[3px] rounded-full ${i === active ? "bg-accent" : "bg-separator"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
