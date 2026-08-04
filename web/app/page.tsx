import { Button, Card } from "@heroui/react";
import { getTranslations } from "next-intl/server";
import { signIn } from "@/app/auth/actions";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";

// Scaffold-stage home page. The real surface is a full-screen Apple Map with
// a bottom sheet (slice: map-home). This page proves the stack is wired:
// Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl + next-themes — and now
// Supabase OAuth (slice: auth-foundation).
export default async function HomePage() {
  const t = await getTranslations("home");

  let user = null;
  if (isAuthConfigured()) {
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("hero_title")}
        </h1>
        <p className="mt-2 text-sm opacity-70">{t("hero_subtitle")}</p>
      </div>

      <Card className="w-full max-w-sm p-6">
        {user ? (
          <div className="flex flex-col gap-1">
            <Card.Title>
              {t("signed_in_as")}{" "}
              {(user.user_metadata?.full_name as string) ??
                (user.email ?? "")}
            </Card.Title>
            <Card.Description>{t("session_ready")}</Card.Description>
          </div>
        ) : (
          <>
            <Card.Header>
              <Card.Title>{t("signin_title")}</Card.Title>
              <Card.Description>{t("signin_subtitle")}</Card.Description>
            </Card.Header>
            <Card.Footer className="flex-col gap-2 pt-3">
              <form action={signIn.bind(null, "apple")} className="w-full">
                <Button variant="primary" type="submit" className="w-full">
                  {t("continue_apple")}
                </Button>
              </form>
              <form action={signIn.bind(null, "google")} className="w-full">
                <Button variant="outline" type="submit" className="w-full">
                  {t("continue_google")}
                </Button>
              </form>
            </Card.Footer>
          </>
        )}
      </Card>

      {!isAuthConfigured() && (
        <p className="max-w-sm text-center text-xs opacity-50">
          {t("auth_not_configured")}
        </p>
      )}
    </main>
  );
}
