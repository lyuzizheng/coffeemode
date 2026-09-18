import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { profileFromUser } from "@/lib/auth/profiles";
import { getProfile } from "@/lib/db/profile";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return {
    title: `${t("title")} · CafeMood`,
    robots: { index: false, follow: false },
  };
}

/** /settings (BRAWUKA-504): preferences + account + legal in one grouped
 * surface. Anonymous visitors keep Preferences + Legal; the Account group
 * renders a sign-in gate row instead of hiding the page behind auth. */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  const profile = user ? await getProfile(user.id) : null;
  const accountInitial = user
    ? (profile?.displayName ?? profileFromUser(user).displayName)[0]?.toUpperCase()
    : undefined;

  return (
    <SettingsView
      initialProfile={profile}
      isAuthenticated={Boolean(user)}
      accountInitial={accountInitial}
    />
  );
}
