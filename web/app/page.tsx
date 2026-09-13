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
      isAuthenticated={Boolean(user)}
    >
      {/* Editorial recomposition (spec 0002 §Editorial grid, BRAWUKA-73):
          asymmetric 12-column grid (8/4 split at ≥lg) with a static
          marginalia column; outer margins ≥ clamp(24px, 6vw, 96px). IA,
          copy, and interactions are unchanged — only composition and
          typography move. Mobile collapses to a single column that keeps
          an asymmetric indent rhythm instead of centering. */}
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between px-[clamp(24px,6vw,96px)] py-4">
          <span className="font-display text-md font-extrabold tracking-tight text-foreground">
            CoffeeMode
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              aria-label="Profile"
              className="group -m-1 flex h-11 w-11 items-center justify-center"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border/50 bg-surface-secondary text-xs font-semibold text-foreground transition-all group-hover:bg-surface-tertiary group-active:scale-95">
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
              </span>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-10 px-[clamp(24px,6vw,96px)] py-10 lg:grid-cols-12 lg:gap-8">
          <div className="min-w-0 lg:col-span-8 lg:col-start-1">
            <p className="font-mono text-xs text-muted">{t("kicker")}</p>
            <h1
              className="mt-3 max-w-[16ch] font-serif text-display text-balance tracking-tight text-foreground sm:text-[3.25rem] sm:leading-[1.08]"
              style={{ fontVariationSettings: '"opsz" 60' }}
            >
              {t("hero_title")}
            </h1>
            <p className="mt-3 max-w-xl text-lede leading-relaxed text-muted">
              {t("hero_subtitle")}
            </p>

            <ol className="ml-4 mt-10 max-w-xl space-y-5 border-t border-separator pt-6 sm:ml-8 lg:ml-0 lg:max-w-none">
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

            <div className="mt-10 w-full max-w-xl rounded-md border border-border/60 bg-surface p-6 shadow-sm">
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

          {/* Static marginalia column (≥lg only): a layout device per spec
              §Editorial grid — plain static echo of existing copy (section
              index + ethos), no links, no motion, no disclosure. */}
          <aside aria-label={t("kicker")} className="hidden min-w-0 lg:col-span-4 lg:block">
            <div className="border-l border-separator pl-6">
              <ol className="space-y-3">
                {steps.map((key, i) => (
                  <li key={key} className="flex gap-3">
                    <span className="tnum shrink-0 font-mono text-xs text-accent">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm text-muted">{t(`steps.${key}.title`)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-6 font-mono text-xs leading-relaxed text-muted">{t("ethos")}</p>
            </div>
          </aside>
        </main>

        <footer className="px-[clamp(24px,6vw,96px)] pb-6">
          <p className="font-mono text-xs text-muted">{t("ethos")}</p>
        </footer>
      </div>
    </DiscoveryHome>
  );
}
