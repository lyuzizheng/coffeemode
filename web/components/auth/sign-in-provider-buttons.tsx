"use client";

import { getAuthProviders } from "@/lib/client-env";
import { SignInButton } from "./sign-in-button";

interface SignInProviderButtonsProps {
  /** Safe return path after the OAuth callback (e.g. "/profile"). */
  next?: string;
}

/**
 * One button per enabled provider, in `auth.providers` order (BRAWUKA-789):
 * the first provider is the primary CTA, the rest outline. A provider that
 * is not enabled is absent from the DOM — never rendered disabled — so the
 * panel cannot offer a sign-in path Supabase would reject. All sign-in
 * gates render this list; callers own only the surrounding panel copy and
 * layout.
 */
export function SignInProviderButtons({ next }: SignInProviderButtonsProps) {
  return (
    <>
      {getAuthProviders().map((provider, index) => (
        <SignInButton
          key={provider}
          provider={provider}
          variant={index === 0 ? "primary" : "outline"}
          next={next}
        />
      ))}
    </>
  );
}
