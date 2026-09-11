"use client";

import { useTranslations } from "next-intl";
import { SignInButton } from "@/components/auth/sign-in-button";

interface CheckinSignInGateProps {
  resumePath: string;
}

export function CheckinSignInGate({ resumePath }: CheckinSignInGateProps) {
  const t = useTranslations("checkIn");

  return (
    <div className="rounded-md border border-separator bg-surface-secondary p-4 text-center">
      <p className="mb-3 text-sm">{t("signInGate")}</p>
      <div className="flex flex-col gap-2">
        <SignInButton provider="google" variant="primary" next={resumePath} />
        <SignInButton provider="apple" variant="outline" next={resumePath} />
      </div>
    </div>
  );
}
