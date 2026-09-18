import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return { title: `${t("title")} · CafeMood` };
}

export default function PrivacyPage() {
  return (
    <LegalPage
      page="privacy"
      sections={["collect", "use", "location", "share", "retention", "rights"]}
    />
  );
}
