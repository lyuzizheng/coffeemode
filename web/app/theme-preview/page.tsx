import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ThemePreview } from "./theme-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("themePreview");
  return { title: t("meta_title") };
}

export default function ThemePreviewPage() {
  return <ThemePreview />;
}
