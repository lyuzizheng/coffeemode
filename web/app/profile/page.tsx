import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { profileFromUser } from "@/lib/auth/profiles";
import { getProfile, getUserStats } from "@/lib/db/profile";
import { ProfileView } from "@/components/profile/profile-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return {
    title: `${t("title")} · CafeMood`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();

  let profile = null;
  let stats = null;

  if (user) {
    [profile, stats] = await Promise.all([
      getProfile(user.id),
      getUserStats(user.id),
    ]);
  }

  const accountInitial = user
    ? (profile?.displayName ?? profileFromUser(user).displayName)[0]?.toUpperCase()
    : undefined;

  return (
    <ProfileView
      initialProfile={profile}
      initialStats={stats}
      isAuthenticated={Boolean(user)}
      accountInitial={accountInitial}
    />
  );
}
