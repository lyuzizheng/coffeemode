import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { BetaSurface } from "@/components/beta/beta-surface";
import { getCurrentUser } from "@/lib/auth/get-user";
import { betaDecisionFor } from "@/lib/beta/access";
import { betaInviteEmail, isBetaEnabled } from "@/lib/beta/config";

/**
 * Closed-beta surface (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * The proxy rewrites every refused page request here, so this route is the one
 * place an uninvited visitor can see. It is also reachable directly:
 *
 * - admitted identity → `/`, nothing to do here;
 * - gate off → `/`, the beta page must never be a dead end;
 * - signed-in but refused → the refusal state with sign-out;
 * - anonymous → the invitation state.
 *
 * Admission is decided server-side (`getCurrentUser` + the allowlist), never by
 * a query parameter: `?denied=1` only selects which copy an anonymous visitor
 * sees after the sign-in callback refused them.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("beta");
  return {
    title: `${t("title")} · CafeMood`,
    robots: { index: false, follow: false },
  };
}

export default async function BetaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isBetaEnabled()) redirect("/");

  const params = (await searchParams) ?? {};
  const user = await getCurrentUser();

  if (user) {
    const decision = await betaDecisionFor(user.email);
    if (decision.allowed) redirect("/");
  }

  return (
    <BetaSurface
      denied={Boolean(user) || params.denied === "1"}
      refusedEmail={user?.email ?? null}
      inviteEmail={betaInviteEmail()}
    />
  );
}
