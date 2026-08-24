"use client";

/**
 * DG111 recovery block on the gone-cafe 404: cafes near the gone cafe's last
 * known location, each linking to its /cafes/[id] page. We already know where
 * the gone cafe was, so this never requests the user's geolocation (DG112).
 *
 * Client-side by necessity: the not-found boundary receives no route params,
 * so the attempted id is read from the URL. Until cafe deletion retains a
 * row/location, the endpoint answers empty and the block stays hidden —
 * the quiet 404 above is the whole surface.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { isValidUUID } from "@shared/uuid";
import { formatDistanceKm } from "@/lib/discovery/view-model";
import type { CafeSummary } from "@/types/cafes";

export function CafeRecoveryBlock({ cafeId }: { cafeId?: string }) {
  const t = useTranslations("cafeDetail");
  const params = useParams<{ id: string }>();
  // Global-404 callers pass the attempted id (read from the x-gone-cafe-id
  // proxy header); the segment boundary has route params instead.
  const id = cafeId ?? (typeof params?.id === "string" ? params.id : null);
  const [cafes, setCafes] = useState<CafeSummary[] | null>(null);

  useEffect(() => {
    if (!id || !isValidUUID(id)) return;
    const controller = new AbortController();
    fetch(`/api/cafes/${id}/recovery`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { cafes: [] }))
      .then((body: { cafes?: CafeSummary[] }) => setCafes(body.cafes ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setCafes([]);
      });
    return () => controller.abort();
  }, [id]);

  if (!cafes || cafes.length === 0) return null;
  return (
    <section className="w-full max-w-sm text-left" aria-label={t("recovery_title")}>
      <h2 className="text-sm font-medium text-foreground">{t("recovery_title")}</h2>
      <ul className="mt-2 flex flex-col gap-0.5">
        {cafes.map((cafe) => {
          const km = formatDistanceKm(cafe.distance_m);
          return (
            <li key={cafe.id}>
              <Link
                href={`/cafes/${cafe.id}`}
                className="cm-focus flex items-baseline justify-between gap-3 rounded-sm px-1 py-1.5 text-sm text-foreground transition-colors hover:text-accent"
              >
                <span className="truncate">{cafe.name}</span>
                {km !== null && <span className="tnum shrink-0 text-xs text-muted">{km} km</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
