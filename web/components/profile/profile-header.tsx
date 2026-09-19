"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppMenu } from "@/components/layout/app-menu";

/**
 * /profile header (BRAWUKA-504): back chevron + title + the global
 * account/menu cluster — the same chrome the map carries, so theme,
 * language, settings, and sign-out all live in the menu now (the old
 * inline ThemeToggle/SignOutButton pair is gone).
 */
export function ProfileHeader({
  isAuthenticated,
  accountInitial,
}: {
  isAuthenticated: boolean;
  accountInitial?: string;
}) {
  const t = useTranslations("profile");
  const router = useRouter();

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <header className="w-full max-w-[var(--layout-content-max)] px-4 md:px-6 pt-4 pb-2 flex items-center justify-between">
      <button
        onClick={handleBack}
        aria-label={t("back")}
        className="inline-flex items-center justify-center w-11 h-11 -ml-2.5 -my-0.5 rounded-full hover:bg-surface-secondary text-foreground active:scale-95 transition-all"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.5 15L7.5 10L12.5 5" />
        </svg>
      </button>
      <span className="font-display font-semibold text-lg">{t("title")}</span>
      <AppMenu
        variant="page"
        accountInitial={isAuthenticated ? accountInitial : undefined}
      />
    </header>
  );
}
