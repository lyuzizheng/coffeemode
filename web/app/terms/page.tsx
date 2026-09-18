import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms");
  return { title: `${t("title")} · CafeMood` };
}

export default function TermsPage() {
  return (
    <LegalPage
      page="terms"
      sections={["service", "content", "conduct", "accuracy", "changes", "contact"]}
    />
  );
}
