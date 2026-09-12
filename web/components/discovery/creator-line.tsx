"use client";

/**
 * Cafe creator attribution line (spec 0006 Q3/Q12, Stage 3).
 *
 * Precedence: consented `author` first; then the service-account maintainer
 * line, which the server signals as the locale-independent
 * `maintained_by_service` marker and the client renders in the active locale;
 * otherwise the existing anonymous `a_nomad` copy. Gallery credit stays
 * anonymous (Q10) — this line attributes the cafe, never individual photos.
 */
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { PublicAuthor } from "@/types/identity";

export function CreatorLine({
  author,
  maintainedByService,
}: {
  author: PublicAuthor | null;
  maintainedByService: boolean;
}) {
  const t = useTranslations("discovery");

  if (author) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {author.avatar_url && (
          <Image
            src={author.avatar_url}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 rounded-full object-cover"
          />
        )}
        <span>{t("by_author", { name: author.display_name })}</span>
      </p>
    );
  }

  if (maintainedByService) {
    return <p className="text-xs text-muted">{t("maintained_by_service")}</p>;
  }

  return <p className="text-xs text-muted">{t("a_nomad")}</p>;
}
