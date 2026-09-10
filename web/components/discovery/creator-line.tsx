"use client";

/**
 * Cafe creator attribution line (spec 0006 Q3/Q12, Stage 3).
 *
 * Precedence: consented `author` first; then the service-account maintainer
 * label (`maintainer`, locale-independent by server contract); otherwise the
 * existing anonymous `a_nomad` copy. Gallery credit stays anonymous (Q10) —
 * this line attributes the cafe, never individual photos.
 */
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { PublicAuthor } from "@/types/identity";

export function CreatorLine({
  author,
  maintainer,
}: {
  author: PublicAuthor | null;
  maintainer: string | null;
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

  if (maintainer) {
    return <p className="text-xs text-muted">{maintainer}</p>;
  }

  return <p className="text-xs text-muted">{t("a_nomad")}</p>;
}
