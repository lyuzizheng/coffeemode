"use client";

/**
 * "仅你可见" / "Only you can see this" marker for owner-private cafes (DG147,
 * BRAWUKA-515). Rendered wherever an owner's private cafe can appear: the
 * in-app detail heading, discovery rows (index + PEEK cards), search results,
 * and the profile "我的咖啡地图" tab.
 *
 * Render only when `visibility === "private"` — every read path already
 * filters private cafes to the creator (reads.ts / search.ts / user-cafes.ts),
 * so a private row reaching the client is always the viewer's own. The badge
 * is a marker, not the leak guard.
 *
 * Same quiet treatment as the SSR badge (surface-secondary pill, muted ink) —
 * identical in-app keeps the two surfaces visually consistent.
 */
import { useTranslations } from "next-intl";

export function PrivateBadge() {
  const t = useTranslations("cafeDetail");
  return (
    <span className="shrink-0 rounded-sm bg-surface-secondary px-2.5 py-1 text-xs text-muted">
      {t("private_badge")}
    </span>
  );
}
