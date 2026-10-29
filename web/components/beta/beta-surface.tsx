"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CoffeeIcon } from "@/components/icons";
import { SignInProviderButtons } from "@/components/auth/sign-in-provider-buttons";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { APP_NAME } from "@/lib/site";

/**
 * The closed-beta surface (BRAWUKA-970, `docs/design/beta-gate-v1.md`).
 *
 * Two states, one composition: invitation (anonymous visitor) and refusal
 * (signed in, address not on the allowlist). Client component so both
 * languages render from the shared catalogs and the provider buttons keep
 * their existing contract; the admission decision itself never happens here —
 * the page and the proxy own it.
 *
 * Deliberately absent: signup, password, Apple, waitlist counters, banners.
 * The beta is invitation-only, so the only actions are the enabled providers,
 * the invitation request, and (when a refusal leaves a session open) sign-out.
 */
export interface BetaSurfaceProps {
  /** True when the visitor reached this surface by being refused. */
  denied: boolean;
  /** Email of a still-open refused session; null when signed out. */
  refusedEmail?: string | null;
  /** Invitation inbox (`beta.inviteEmail`) behind the request link. */
  inviteEmail: string;
}

export function BetaSurface({ denied, refusedEmail = null, inviteEmail }: BetaSurfaceProps) {
  const t = useTranslations("beta");
  const mailto = `mailto:${inviteEmail}?subject=${encodeURIComponent(t("requestSubject"))}`;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10 text-foreground md:px-8">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-2">
          <CoffeeIcon size={18} className="text-accent" />
          <span className="font-display text-md font-extrabold tracking-tight">{APP_NAME}</span>
        </div>

        <div className="border-t border-separator" />

        <div className="flex flex-col gap-3">
          <p className="font-mono tnum text-xs uppercase tracking-[0.18em] text-muted">
            {denied ? t("deniedKicker") : t("kicker")}
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {denied ? t("deniedTitle") : t("title")}
          </h1>
          <p className="max-w-[34ch] font-serif text-md leading-relaxed text-muted">
            {denied ? t("deniedBody") : t("body")}
          </p>
          {denied && refusedEmail ? (
            <p className="font-mono text-xs break-all text-muted">
              {t("signedInAs", { email: refusedEmail })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <SignInProviderButtons />
          {denied && refusedEmail ? <SignOutButton variant="outline" /> : null}
          <a
            href={mailto}
            className="cm-focus inline-flex min-h-11 items-center justify-center rounded-md text-sm text-foreground underline decoration-separator underline-offset-4 transition-colors duration-150 hover:text-accent motion-reduce:transition-none"
          >
            {t("request")}
          </a>
        </div>

        <footer className="flex items-center justify-center gap-3 text-xs text-muted">
          <Link href="/privacy" className="cm-focus rounded-md px-1 py-2 hover:text-foreground">
            {t("footerPrivacy")}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/terms" className="cm-focus rounded-md px-1 py-2 hover:text-foreground">
            {t("footerTerms")}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/about" className="cm-focus rounded-md px-1 py-2 hover:text-foreground">
            {t("footerAbout")}
          </Link>
        </footer>
      </div>
    </main>
  );
}
