import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { resolveAppVersion } from "@/lib/version";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.about");
  return { title: `${t("title")} · CafeMood` };
}

export default function AboutPage() {
  return (
    <LegalPage
      page="about"
      sections={["mission", "principles", "craft", "version"]}
      values={{ version: resolveAppVersion() }}
    />
  );
}
