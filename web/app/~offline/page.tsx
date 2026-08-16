"use client";

import { useTranslations } from "next-intl";

/** Wifi-off glyph — same stroke language as the app icon set. */
function WifiOffIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8.82a15 15 0 0 1 5.72-3.4" />
      <path d="M22 8.82a15 15 0 0 0-11.29-4.55" />
      <path d="M8.53 12.11a10 10 0 0 1 6.94 0" />
      <path d="M12 20h.01" />
      <path d="M5.05 15.06a7.5 7.5 0 0 1 4.2-1.98" />
      <path d="M16.51 12.86a7.5 7.5 0 0 1 2.44 2.2" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export default function OfflinePage() {
  const t = useTranslations("offline");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <WifiOffIcon />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">
          {t("body")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="cm-focus h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors duration-150 hover:bg-accent-hover"
      >
        {t("retry")}
      </button>
    </main>
  );
}
