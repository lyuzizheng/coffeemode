"use client";

/**
 * Floating account + theme chip on the map surface (BRAWUKA-318): restores
 * the affordances the deleted landing header carried — profile entry when
 * signed in, a sign-in affordance when not, and the theme toggle — as one
 * minimal pill in the mapOverlay slot. `/profile` renders the sign-in gate
 * for anonymous visitors, so a single link covers both states.
 *
 * Placement: top-right on mobile (the sheet owns the bottom); on desktop it
 * sits left of the locate button, which owns the top-right map corner
 * (DG42). gateMapOverlay hides it whenever the sheet is above PEEK.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";

export function MapAccountChip({
  accountInitial,
}: {
  /** Signed-in display-name initial; absent → the sign-in affordance. */
  accountInitial?: string;
}) {
  const t = useTranslations("map");

  return (
    <div className="fixed right-4 top-[76px] z-40 flex items-center gap-1.5 rounded-full border border-separator bg-overlay p-1.5 shadow-map lg:right-[76px] lg:top-6">
      <Link
        href="/profile"
        aria-label={accountInitial ? t("profile_aria") : t("sign_in")}
        className="cm-focus flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm text-foreground transition-colors hover:bg-surface-secondary"
      >
        {accountInitial ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary font-semibold">
            {accountInitial}
          </span>
        ) : (
          <span className="px-2.5 font-medium">{t("sign_in")}</span>
        )}
      </Link>
      <ThemeToggle variant="bare" />
    </div>
  );
}
