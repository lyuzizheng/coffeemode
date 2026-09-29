"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { signOut, type AuthActionState } from "@/lib/auth/actions";
import { AuthErrorMessage } from "./auth-error-message";
import { clearClientState } from "@/lib/query/clear-client-state";

export function SignOutButton({
  variant = "outline",
  className = "w-full",
}: {
  variant?: "primary" | "outline" | "ghost";
  className?: string;
} = {}) {
  const t = useTranslations("home");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, formAction, isPending] = useActionState<AuthActionState | undefined, FormData>(
    signOut,
    undefined,
  );

  useEffect(() => {
    if (state?.success) {
      clearClientState(queryClient, (e) =>
        console.error("sign-out-button: failed to clear persisted cache", e),
      ).finally(() => router.push("/"));
    }
  }, [state, queryClient, router]);

  return (
    <form action={formAction} className={className}>
      <Button
        type="submit"
        variant={variant}
        isDisabled={isPending}
        className="w-full min-h-[44px]"
        aria-busy={isPending}
      >
        {isPending ? t("signing_out") : t("sign_out")}
      </Button>
      <AuthErrorMessage error={state?.error} />
    </form>
  );
}
