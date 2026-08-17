"use client";

import { useTranslations } from "next-intl";

/** Triangle-alert glyph — same stroke language as the app icon set. */
function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-danger"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Visible feedback for a failed OAuth round-trip. The callback route redirects
 * to `/?auth=error[&reason=...]`; the home page renders this banner above the
 * sign-in card so a failed sign-in is never silent. Icon + text: color is
 * never the only signal (spec 0002).
 */
export function AuthCallbackError({ reason }: { reason?: string }) {
  const t = useTranslations("home");
  const message =
    reason === "profile_upsert" ? t("auth_error_profile") : t("auth_error");

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-4 py-3"
    >
      <AlertIcon />
      <p className="text-sm leading-relaxed text-foreground">{message}</p>
    </div>
  );
}
