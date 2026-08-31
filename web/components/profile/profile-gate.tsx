"use client";

import { useTranslations } from "next-intl";
import { CoffeeIcon } from "@/components/icons";
import { SignInButton } from "@/components/auth/sign-in-button";

export function ProfileGate() {
  const t = useTranslations("profile");

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 relative">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
        <CoffeeIcon size={240} />
      </div>
      <div className="w-20 h-20 rounded-full bg-surface-tertiary flex items-center justify-center mb-6 text-muted border border-border/40">
        <CoffeeIcon size={36} />
      </div>
      <h1 className="font-display font-bold text-2xl mb-3 text-foreground">
        {t("gate_title")}
      </h1>
      <p className="text-sm text-muted max-w-sm mb-8 leading-relaxed">
        {t("gate_body")}
      </p>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <SignInButton provider="apple" variant="primary" next="/profile" />
        <SignInButton provider="google" variant="outline" next="/profile" />
      </div>
    </div>
  );
}
