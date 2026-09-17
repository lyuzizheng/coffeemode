/**
 * The dossier hero (BRAWUKA-364): the cover carousel when photos exist,
 * else a monogram plate — the cafe's initial set large on a warm tonal
 * field with the grain overlay, so a photo-less cafe still opens with a
 * designed first impression. Server-safe (no client hooks) so the SSR
 * cafe shell renders it inline.
 */
import { CoverCarousel } from "@/components/cafe/cover-carousel";

export function DossierHero({ covers, name }: { covers: string[]; name: string }) {
  if (covers.length > 0) return <CoverCarousel images={covers} alt={name} />;
  return (
    <div
      aria-hidden
      className="grain-overlay relative flex aspect-[21/9] w-full items-center justify-center overflow-hidden rounded-md border border-separator bg-surface-secondary"
    >
      <span className="font-display text-3xl font-extrabold tracking-tight text-foreground/20 select-none">
        {name.trim().charAt(0).toUpperCase()}
      </span>
    </div>
  );
}
