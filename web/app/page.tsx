import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { profileFromUser } from "@/lib/auth/profiles";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { appConfig } from "@/lib/config";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInButton } from "@/components/auth/sign-in-button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { AuthCallbackError } from "@/components/auth/auth-callback-error";
import { CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";
import { DiscoveryHome } from "@/components/discovery/discovery-home";

// Scaffold-stage home page. The real surface is a full-screen Apple Map with
// a map-bound discovery sheet (slices: map-home, map-discovery-integration). Until then this page is the honest first
// impression: what the tool is, how it works, and sign-in only when it can
// actually work — never a wall in front of value, never a dead button.
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("home");
  const configured = isAuthConfigured();
  // The OAuth callback redirects here with ?auth=error on failure — surface
  // it instead of dropping the user back on a silent page (issue #98).
  const params = (await searchParams) ?? {};
  const authError = params.auth === "error";
  const authErrorReason =
    typeof params.reason === "string" ? params.reason : undefined;

  let user = null;
  if (configured) {
    const supabase = await createSupabaseServerClient();
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      // Supabase unreachable: degrade to the signed-out view instead of
      // turning the whole page into a 500 (availability > session display).
      user = null;
    }
  }

  const steps = ["find", "checkin", "keep"] as const;

  return (
    <DiscoveryHome
      defaultCenter={appConfig.discovery.defaultCenter}
      addCafe={<CafeCreationTrigger isAuthenticated={Boolean(user)} />}
      initialCafeId={typeof params.cafe === "string" ? params.cafe : undefined}
    >
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <span className="font-display text-md font-extrabold tracking-tight text-foreground">
            CoffeeMode
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              aria-label="Profile"
              className="w-9 h-9 rounded-full bg-surface-secondary border border-border/50 flex items-center justify-center text-foreground hover:bg-surface-tertiary active:scale-95 transition-all text-xs font-semibold"
            >
              {user ? (
                profileFromUser(user).displayName[0]?.toUpperCase() ?? "P"
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="8" cy="5" r="3" />
                  <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
                </svg>
              )}
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
          <div className="w-full max-w-md">
            <p className="font-mono text-xs text-muted">{t("kicker")}</p>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">
              {t("hero_title")}
            </h1>
            <p className="mt-2 text-base leading-relaxed text-muted">
              {t("hero_subtitle")}
            </p>

            <ol className="mt-10 space-y-5 border-t border-separator pt-6">
              {steps.map((key, i) => (
                <li key={key} className="flex gap-4">
                  <span className="tnum mt-0.5 shrink-0 font-mono text-xs text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-foreground">
                      {t(`steps.${key}.title`)}
                    </h2>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">
                      {t(`steps.${key}.body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {authError && <AuthCallbackError reason={authErrorReason} />}

            <div className="mt-10 w-full rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
              {user ? (
                <>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-display text-lg font-bold text-foreground">
                      {t("signed_in_as")} {profileFromUser(user).displayName}
                    </h3>
                    <p className="text-sm text-muted">{t("session_ready")}</p>
                  </div>
                  <div className="flex flex-col gap-2 pt-4">
                    <CafeCreationTrigger isAuthenticated={Boolean(user)} />
                    <SignOutButton />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <h3 className="font-display text-lg font-bold text-foreground">{t("signin_title")}</h3>
                    <p className="text-sm text-muted">
                      {configured ? t("signin_subtitle") : t("auth_not_configured")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 pt-3">
                    <SignInButton provider="apple" variant="primary" disabled={!configured} />
                    <SignInButton provider="google" variant="outline" disabled={!configured} />
                    <div className="pt-2">
                      <CafeCreationTrigger isAuthenticated={false} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>

        <footer className="px-6 pb-6 text-center">
          <p className="font-mono text-xs text-muted">{t("ethos")}</p>
        </footer>
      </div>
    </DiscoveryHome>
  );
}
