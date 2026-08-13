"use client";

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { signOut, type AuthActionState } from "./actions";
import { AuthErrorMessage } from "./auth-error-message";
import { idbPersister } from "@/lib/query/persister";

export function SignOutButton() {
  const t = useTranslations("home");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, formAction, isPending] = useActionState<AuthActionState | undefined, FormData>(
    signOut,
    undefined,
  );

  useEffect(() => {
    if (state?.success) {
      queryClient.clear();
      void Promise.resolve(idbPersister.removeClient()).then(() => router.push("/"));
    }
  }, [state, queryClient, router]);

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
