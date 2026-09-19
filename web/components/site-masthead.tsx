/**
 * Site masthead — wordmark back to the map + the global account/menu
 * cluster (BRAWUKA-504: same chrome as the map and /profile, not a
 * page-local ThemeToggle). Server-safe so SSR shells (`/cafes/[id]`,
 * `/search`) render it with zero hydration.
 */
import Link from "next/link";
import { AppMenu } from "@/components/layout/app-menu";
import { CoffeeIcon } from "@/components/icons";
import { APP_NAME } from "@/lib/site";

export function SiteMasthead({ accountInitial }: { accountInitial?: string }) {
  return (
    <header className="flex items-center justify-between border-b border-separator px-4 py-3 sm:px-6">
      <Link
        href="/"
        className="-my-2.5 inline-flex min-h-11 items-center gap-2 font-display text-md font-extrabold tracking-tight text-foreground"
      >
        <CoffeeIcon size={18} className="text-accent" />
        {APP_NAME}
      </Link>
      <AppMenu variant="page" accountInitial={accountInitial} />
    </header>
  );
}
