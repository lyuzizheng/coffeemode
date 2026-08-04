import { Button, Card } from "@heroui/react";
import { getTranslations } from "next-intl/server";

// Scaffold-stage home page. The real surface is a full-screen Apple Map with
// a bottom sheet (slice: map-home). This page only proves the stack is wired:
// Next.js 16 + HeroUI v3 + Tailwind v4 + next-intl + next-themes.
export default async function HomePage() {
  const t = await getTranslations("home");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("hero_title")}
        </h1>
        <p className="mt-2 text-sm opacity-70">{t("hero_subtitle")}</p>
      </div>

      <Card className="max-w-sm p-6">
        <Card.Header>
          <Card.Title>CoffeeMode</Card.Title>
          <Card.Description>
            Scaffold verified — map, sheet, and check-in flows land in later
            slices.
          </Card.Description>
        </Card.Header>
        <Card.Footer className="pt-2">
          <Button variant="primary">{t("cta_search")}</Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
