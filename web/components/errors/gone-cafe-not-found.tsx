"use client";

/**
 * Gone-cafe 404 composition (DG19, seo-sharing artifact §5): quiet and
 * final — no cute illustration, no coffee-pun copy. Client component so it
 * renders synchronously during SSR (a suspended server component would
 * stream and demote the real 404 to a soft-404 200).
 *
 * The nearby-recovery block (DG111) never asks for the user's location
 * (DG112) — suggestions are relative to the gone cafe's own last known
 * location, resolved server-side by the recovery endpoint.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CafeRecoveryBlock } from "@/components/cafe/cafe-recovery-block";

export function GoneCafeNotFound({ cafeId }: { cafeId?: string }) {
  const t = useTranslations("cafeDetail");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          {t("gone_title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("gone_body")}</p>
      </div>
      <Link
        href="/"
        className="cm-focus flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-hover"
      >
        {t("back_to_discover")}
      </Link>
      <CafeRecoveryBlock cafeId={cafeId} />
    </main>
  );
}
