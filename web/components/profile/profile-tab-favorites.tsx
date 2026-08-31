"use client";

import { useTranslations } from "next-intl";
import { HeartIcon } from "@/components/icons";

export function ProfileTabFavorites({ baseId }: { baseId: string }) {
  const t = useTranslations("profile");

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-favorites`}
      aria-labelledby={`${baseId}-tab-favorites`}
      className="py-16 flex flex-col items-center justify-center text-center px-4"
    >
      <div className="w-12 h-12 rounded-full bg-surface-secondary flex items-center justify-center mb-3 text-muted">
        <HeartIcon size={20} />
      </div>
      <h2 className="font-display font-semibold text-lg text-foreground mb-1">
        {t("empty_favorites_title")}
      </h2>
      <p className="text-sm text-muted max-w-xs leading-relaxed">
        {t("empty_favorites_body")}
      </p>
    </div>
  );
}
