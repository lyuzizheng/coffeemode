import { Card } from "@heroui/react";
import { getTranslations } from "next-intl/server";
import { profileFromUser } from "@/lib/auth/profiles";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInButton } from "@/app/auth/sign-in-button";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { AuthCallbackError } from "@/app/auth/auth-callback-error";

// Scaffold-stage home page. The real surface is a full-screen Apple Map with
// a bottom sheet (slice: map-home). Until then this page is the honest first
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
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <span className="font-display text-md font-extrabold tracking-tight text-foreground">
          CoffeeMode
        </span>
        <ThemeToggle />
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

          <Card className="mt-10 w-full p-6">
            {user ? (
              <>
                <div className="flex flex-col gap-1">
                  <Card.Title>
                    {t("signed_in_as")} {profileFromUser(user).displayName}
                  </Card.Title>
                  <Card.Description>{t("session_ready")}</Card.Description>
                </div>
                <Card.Footer className="pt-4">
                  <SignOutButton />
                </Card.Footer>
              </>
            ) : (
              <>
                <Card.Header>
                  <Card.Title>{t("signin_title")}</Card.Title>
                  <Card.Description>
                    {configured ? t("signin_subtitle") : t("auth_not_configured")}
                  </Card.Description>
                </Card.Header>
                <Card.Footer className="flex-col gap-2 pt-3">
                  <SignInButton provider="apple" variant="primary" disabled={!configured} />
                  <SignInButton provider="google" variant="outline" disabled={!configured} />
                </Card.Footer>
              </>
            )}
          </Card>
        </div>
      </main>

      <footer className="px-6 pb-6 text-center">
        <p className="font-mono text-xs text-muted">{t("ethos")}</p>
      </footer>
    </div>
  );
}
