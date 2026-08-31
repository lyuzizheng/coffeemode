"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { signIn, type AuthActionState, type OAuthProvider } from "@/lib/auth/actions";
import { AuthErrorMessage } from "./auth-error-message";

interface SignInButtonProps {
  provider: OAuthProvider;
  variant: "primary" | "outline";
  /** Disabled when auth cannot work (e.g. Supabase env not configured). */
  disabled?: boolean;
  /** Safe return path after OAuth callback (e.g. "/profile"). */
  next?: string;
}

export function SignInButton({ provider, variant, disabled, next }: SignInButtonProps) {
  const t = useTranslations("home");
  const [state, formAction, isPending] = useActionState<AuthActionState | undefined, FormData>(
    signIn,
    undefined,
  );

  const label = provider === "apple" ? t("continue_apple") : t("continue_google");

  return (
    <form action={formAction} className="w-full">
      <input type="hidden" name="provider" value={provider} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Button
        type="submit"
        variant={variant}
        isDisabled={isPending || disabled}
        className="w-full"
        aria-busy={isPending}
      >
        {isPending ? t("signing_in") : label}
      </Button>
      <AuthErrorMessage error={state?.error} />
    </form>
  );
}
