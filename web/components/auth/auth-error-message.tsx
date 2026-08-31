"use client";

import { useTranslations } from "next-intl";

/** Stable codes from the auth server actions → i18n keys under `home`. */
const CODE_KEYS = {
  invalid_provider: "auth_err_invalid_provider",
  not_configured: "auth_err_not_configured",
  provider_start_failed: "auth_err_start",
  signout_failed: "auth_err_signout",
} as const;

interface AuthErrorMessageProps {
  /** Stable error code from the auth server actions (never a provider string). */
  error?: string;
}

/**
 * Maps auth action error codes to localized copy. Unknown or legacy values
 * fall back to the generic message — provider internals are never rendered
 * (issue #103).
 */
export function AuthErrorMessage({ error }: AuthErrorMessageProps) {
  const t = useTranslations("home");
  if (!error) return null;

  const key =
    error in CODE_KEYS
      ? CODE_KEYS[error as keyof typeof CODE_KEYS]
      : "auth_err_generic";

  return (
    <p
      className="mt-2 text-center text-xs text-danger"
      role="alert"
      aria-live="polite"
    >
      {t(key)}
    </p>
  );
}
