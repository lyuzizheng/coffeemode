"use client";

/**
 * The droplet panel for AppMenu (BRAWUKA-504): the spring-animated menu
 * surface — scale + corner morph from the trigger, rows staggering in
 * behind it. Lives in its own file so app-menu.tsx stays under the
 * 400-line budget; AppMenu owns the trigger chrome, this owns the panel.
 */
import { motion } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";
import { spring } from "@/lib/motion";
import {
  GearIcon,
  GlobeIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from "@/components/icons";
import type { MapTranslator, ThemeValue } from "./app-menu-types";

const THEME_ICONS: Record<ThemeValue, ReactNode> = {
  light: <SunIcon size={16} />,
  dark: <MoonIcon size={16} />,
  system: <MonitorIcon size={16} />,
};

/** One menu row: icon + label + trailing value, 44px hit area. */
function MenuRow({
  icon,
  label,
  value,
  onSelect,
  href,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onSelect?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex h-5 w-5 items-center justify-center text-muted">
        {icon}
      </span>
      <span className="flex-1 text-left text-sm text-foreground">{label}</span>
      {value ? (
        <span className="text-xs font-medium text-muted">{value}</span>
      ) : null}
    </>
  );
  const className =
    "cm-focus flex min-h-11 w-full items-center gap-3 px-4 transition-colors duration-120 hover:bg-surface-secondary";
  if (href) {
    return (
      <Link href={href} data-menu-item className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" data-menu-item onClick={onSelect} className={className}>
      {inner}
    </button>
  );
}

/** The four menu rows — theme, locale, settings, profile — staggered in
 * behind the panel's spring. */
function MenuRows({
  activeTheme,
  nextTheme,
  nextLocale,
  accountInitial,
  reduced,
  onTheme,
  onLocale,
  t,
}: {
  activeTheme: ThemeValue;
  nextTheme: ThemeValue;
  nextLocale: string;
  accountInitial?: string;
  reduced: boolean;
  onTheme: (v: ThemeValue) => void;
  onLocale: () => void;
  t: MapTranslator;
}) {
  const rows = [
    <MenuRow
      key="theme"
      icon={THEME_ICONS[activeTheme]}
      label={t("menu_theme")}
      value={t(`menu_theme_${activeTheme}`)}
      onSelect={() => onTheme(nextTheme)}
    />,
    <MenuRow
      key="locale"
      icon={<GlobeIcon size={16} />}
      label={t("menu_language")}
      value={nextLocale === "zh" ? "中文" : "English"}
      onSelect={onLocale}
    />,
    <MenuRow
      key="settings"
      icon={<GearIcon size={16} />}
      label={t("menu_settings")}
      href="/settings"
    />,
    <MenuRow
      key="profile"
      icon={<UserIcon size={16} />}
      label={accountInitial ? t("profile_aria") : t("menu_sign_in")}
      href="/profile"
    />,
  ];
  return (
    <>
      {rows.map((row) => (
        <motion.div
          key={row.key}
          variants={{
            open: { opacity: 1, y: 0 },
            closed: { opacity: 0, y: -6 },
          }}
          transition={reduced ? { duration: 0 } : spring.gentle}
        >
          {row}
        </motion.div>
      ))}
    </>
  );
}

/** The droplet panel — the spring-animated menu surface. */
export function MenuPanel({
  activeTheme,
  nextTheme,
  nextLocale,
  accountInitial,
  reduced,
  onTheme,
  onLocale,
  t,
}: {
  activeTheme: ThemeValue;
  nextTheme: ThemeValue;
  nextLocale: string;
  accountInitial?: string;
  reduced: boolean;
  onTheme: (v: ThemeValue) => void;
  onLocale: () => void;
  t: MapTranslator;
}) {
  return (
    <motion.div
      role="menu"
      aria-label={t("menu_aria")}
      initial={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.3, y: -6, borderRadius: 24 }
      }
      animate={
        reduced
          ? { opacity: 1 }
          : { opacity: 1, scale: 1, y: 0, borderRadius: 8 }
      }
      exit={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.3, y: -6, borderRadius: 24 }
      }
      transition={
        reduced ? { duration: 0 } : { ...spring.snappy, opacity: { duration: 0.12 } }
      }
      style={{ transformOrigin: "top right" }}
      className="absolute right-0 top-[calc(100%+10px)] w-60 overflow-hidden rounded-lg border border-separator bg-overlay shadow-map"
    >
      <motion.div
        className="divide-y divide-separator"
        initial="closed"
        animate="open"
        variants={{
          open: {
            transition: reduced
              ? {}
              : { staggerChildren: 0.035, delayChildren: 0.05 },
          },
          closed: {},
        }}
      >
        <MenuRows
          activeTheme={activeTheme}
          nextTheme={nextTheme}
          nextLocale={nextLocale}
          accountInitial={accountInitial}
          reduced={reduced}
          onTheme={onTheme}
          onLocale={onLocale}
          t={t}
        />
      </motion.div>
    </motion.div>
  );
}
