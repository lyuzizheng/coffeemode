import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getProfile, getUserStats } from "@/lib/db/profile";
import { ProfileView } from "@/components/profile/profile-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile · CoffeeMode",
  robots: {
    index: false,
    follow: false,
  },
};

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

  return (
    <ProfileView
      initialProfile={profile}
      initialStats={stats}
      isAuthenticated={Boolean(user)}
    />
  );
}
