"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/auth/sign-out-button";

export function ProfileHeader({ isAuthenticated }: { isAuthenticated: boolean }) {
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
    <header className="w-full max-w-[640px] px-4 md:px-6 pt-4 pb-2 flex items-center justify-between">
      <button
        onClick={handleBack}
        aria-label={t("back")}
        className="inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-full hover:bg-surface-secondary text-foreground active:scale-95 transition-all"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.5 15L7.5 10L12.5 5" />
        </svg>
      </button>
      <span className="font-display font-semibold text-lg">{t("title")}</span>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {isAuthenticated && (
          <SignOutButton
            variant="ghost"
            className="inline-flex min-h-12 min-w-12 items-center"
          />
        )}
      </div>
    </header>
  );
}
