"use client";

/**
 * Global account/menu cluster (BRAWUKA-504): two round buttons — the
 * account affordance (avatar initial → /profile when signed in, person
 * glyph → /profile's sign-in gate when not) and the menu trigger — plus a
 * droplet panel carrying theme, locale, settings, and profile entries.
 *
 * One component, two placements: `variant="map"` floats top-right over the
 * map (below the mobile search capsule via --layout-chrome-offset);
 * `variant="page"` renders inline inside a content-page header. Every page
 * uses the same cluster — no map-vs-content chrome fork.
 *
 * The droplet open is the signature beat: the panel springs out of the
 * trigger (scale + corner morph, transform-origin at the button) and the
 * rows stagger in behind it; close reverses into the button. Reduced
 * motion collapses it to an instant swap.
 */
import { AnimatePresence, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { MenuIcon, UserIcon } from "@/components/icons";
import { MenuPanel } from "./app-menu-panel";
import { THEME_ORDER, type MapTranslator, type ThemeValue } from "./app-menu-types";

/** Outside pointerdown closes; Escape closes and restores trigger focus;
 * Tab wraps inside the panel (focus trap), arrows walk the rows. */
function useMenuDismissal(
  rootRef: React.RefObject<HTMLDivElement | null>,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  open: boolean,
  setOpen: (v: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const items = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [],
      );
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Tab") {
        event.preventDefault();
        const next =
          index === -1
            ? 0
            : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next =
          index === -1
            ? 0
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, rootRef, triggerRef, setOpen]);
}

/** Focus lands on the first row when the panel opens. */
function useMenuFocus(
  rootRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector<HTMLElement>("[data-menu-item]")
      ?.focus();
  }, [open, rootRef]);
}

/** The two-button chrome + panel slot — extracted so AppMenu stays under
 * the 80-line budget. */
function AppMenuChrome(props: {
  variant: "map" | "page";
  rootRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  accountInitial?: string;
  activeTheme: ThemeValue;
  nextTheme: ThemeValue;
  nextLocale: string;
  reduced: boolean;
  onTheme: (v: ThemeValue) => void;
  onLocale: () => void;
  t: MapTranslator;
}) {
  const { variant, rootRef, triggerRef, open, setOpen, accountInitial, t } = props;
  return (
    <div
      ref={rootRef}
      className={
        variant === "map"
          ? "fixed right-4 top-[var(--layout-chrome-offset)] z-50 flex items-center gap-2 lg:right-6 lg:top-6"
          : "relative flex items-center gap-2"
      }
    >
      <Link
        href="/profile"
        aria-label={accountInitial ? t("profile_aria") : t("menu_sign_in")}
        className="cm-focus flex h-11 w-11 items-center justify-center rounded-full border border-separator bg-overlay text-sm text-foreground shadow-map transition-colors hover:bg-surface-secondary"
      >
        {accountInitial ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-secondary font-semibold">
            {accountInitial}
          </span>
        ) : (
          <UserIcon size={18} className="text-muted" />
        )}
      </Link>

      <button
        ref={triggerRef}
        type="button"
        aria-label={t("menu_aria")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="cm-focus flex h-11 w-11 items-center justify-center rounded-full border border-separator bg-overlay text-muted shadow-map transition-colors hover:bg-surface-secondary hover:text-foreground active:scale-95"
      >
        <MenuIcon size={18} />
      </button>

      <AnimatePresence>
        {open && <MenuPanel {...props} />}
      </AnimatePresence>
    </div>
  );
}

export function AppMenu({
  accountInitial,
  variant = "map",
}: {
  /** Signed-in display-name initial; absent → the sign-in affordance. */
  accountInitial?: string;
  /** "map" floats over the basemap; "page" renders inline in a header. */
  variant?: "map" | "page";
}) {
  const t = useTranslations("map");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeTheme: ThemeValue =
    mounted && (theme === "light" || theme === "dark" || theme === "system")
      ? theme
      : "system";
  const nextTheme: ThemeValue =
    THEME_ORDER[(THEME_ORDER.indexOf(activeTheme) + 1) % THEME_ORDER.length];
  const nextLocale = locale === "zh" ? "en" : "zh";

  // Route changes close the panel — a menu must never outlive its context.
  // The effect returns the cleanup so the setState stays async (React
  // Compiler rule: no synchronous setState inside an effect body).
  useEffect(() => () => setOpen(false), [pathname]);
  useMenuDismissal(rootRef, triggerRef, open, setOpen);
  useMenuFocus(rootRef, open);

  const switchLocale = () => {
    // The i18n request config reads the `locale` cookie (i18n/request.ts);
    // a refresh re-renders server + client messages in the new language.
    document.cookie = `locale=${nextLocale};path=/;max-age=31536000;SameSite=Lax`;
    router.refresh();
  };

  return (
    <AppMenuChrome
      variant={variant}
      rootRef={rootRef}
      triggerRef={triggerRef}
      open={open}
      setOpen={setOpen}
      accountInitial={accountInitial}
      activeTheme={activeTheme}
      nextTheme={nextTheme}
      nextLocale={nextLocale}
      reduced={Boolean(reduced)}
      onTheme={setTheme}
      onLocale={switchLocale}
      t={t}
    />
  );
}
