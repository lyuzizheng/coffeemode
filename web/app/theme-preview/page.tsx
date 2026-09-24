import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ThemePreview } from "./theme-preview";

// Design-QA sandbox, not a public surface (BRAWUKA-425): robots.txt only
// hides it from crawlers, so gate it at render time. APP_ENV (not NODE_ENV)
// is the discriminator — staging runs NODE_ENV=production too but must keep
// the page for QA; CI smoke builds (APP_ENV unset) must keep the 200. Only
// the production deploy sets APP_ENV=production (deploy/dokploy/.env.prod).
// force-dynamic so the gate evaluates per request, not baked at build.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // No loading boundary wraps this route, so this notFound() commits the
  // real 404 status before the shell flushes.
  if (process.env.APP_ENV === "production") notFound();
  const t = await getTranslations("themePreview");
  return { title: t("meta_title"), robots: { index: false, follow: false } };
}

export default function ThemePreviewPage() {
  if (process.env.APP_ENV === "production") notFound();
  return <ThemePreview />;
}
