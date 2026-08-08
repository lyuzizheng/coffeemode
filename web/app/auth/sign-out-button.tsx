"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";
import { signOut, type AuthActionState } from "./actions";
import { AuthErrorMessage } from "./auth-error-message";

export function SignOutButton() {
  const t = useTranslations("home");
  const [state, formAction, isPending] = useActionState<AuthActionState | undefined, FormData>(
    signOut,
    undefined,
  );

  return (
    <form action={formAction} className="w-full">
      <Button
        type="submit"
        variant="outline"
        isDisabled={isPending}
        className="w-full"
        aria-busy={isPending}
      >
        {isPending ? t("signing_out") : t("sign_out")}
      </Button>
      <AuthErrorMessage error={state?.error} />
    </form>
  );
}
