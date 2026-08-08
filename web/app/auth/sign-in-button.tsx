"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { signIn, type AuthActionState, type OAuthProvider } from "./actions";
import { AuthErrorMessage } from "./auth-error-message";

interface SignInButtonProps {
  provider: OAuthProvider;
  variant: "primary" | "outline";
}

export function SignInButton({ provider, variant }: SignInButtonProps) {
  const t = useTranslations("home");
  const [state, formAction, isPending] = useActionState<AuthActionState | undefined, FormData>(
    signIn,
    undefined,
  );

  const label = provider === "apple" ? t("continue_apple") : t("continue_google");

  return (
    <form action={formAction} className="w-full">
      <input type="hidden" name="provider" value={provider} />
      <Button
        type="submit"
        variant={variant}
        isDisabled={isPending}
        className="w-full"
        aria-busy={isPending}
      >
        {isPending ? t("signing_in") : label}
      </Button>
      <AuthErrorMessage error={state?.error} />
    </form>
  );
}
