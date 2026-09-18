/**
 * CafeMood bespoke icon set (discovery-sheet artifact §2, resolves DG6).
 *
 * 16×16 viewBox, 1.5px stroke, round caps/joins, `currentColor`, geometric.
 * HeroUI built-ins are used where they exist; this set covers only what
 * HeroUI lacks. Characteristic icons are decorative: render them
 * `aria-hidden` with the value as real text beside them (DG-accessibility
 * rule — color/shape is never the only signal).
 */
import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Optical size in px (default 16). */
  size?: number;
}

function base({ size = 16, ...props }: IconProps, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-hidden"] ?? true}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Wifi — three concentric arcs + dot. */
export function WifiIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="12" r="0.75" fill="currentColor" stroke="none" />
      <path d="M5 12a3 3 0 0 1 6 0" />
      <path d="M2.5 12a5.5 5.5 0 0 1 11 0" />
      <path d="M0.75 12a7.25 7.25 0 0 1 14.5 0" />
    </>,
  );
}

/** Outlets — two-prong plug with cord stub. */
export function OutletsIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6.25 2.5V5" />
      <path d="M9.75 2.5V5" />
      <rect x="4" y="5" width="8" height="6" rx="2" />
      <path d="M8 11v3" />
    </>,
  );
}

/** Stay limit — clock face, hands at 3h. */
export function StayIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 8V4.75" />
      <path d="M8 8h3" />
    </>,
  );
}

/** Seats — simplified chair profile. */
export function SeatsIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M5.5 2.75V8" />
      <path d="M5.5 8H11" />
      <path d="M6.25 8v5.25" />
      <path d="M10.25 8v5.25" />
    </>,
  );
}

/** Temperature — thermometer. */
export function TempIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6.5 10.75V3.75a1.5 1.5 0 0 1 3 0v7" />
      <circle cx="8" cy="11.75" r="1.75" />
      <path d="M8 10.5V6.5" />
    </>,
  );
}

/** Coffee — plain cup outline (no steam, no beans). */
export function CoffeeIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3.5 5.5h8V9a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 9V5.5Z" />
      <path d="M11.5 6.5h1.25a1.75 1.75 0 0 1 0 3.5H11.5" />
    </>,
  );
}

/** Navigation — paper-plane arrow (nav-prompt pill, "导航" affordances). */
export function NavigationIcon(props: IconProps) {
  return base(
    props,
    <path d="M8 1.75 13.5 14.25 8 11.25 2.5 14.25Z" />,
  );
}

/** Experience score mark — four-point sparkle. */
export function SparkleIcon(props: IconProps) {
  return base(
    props,
    <path d="M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4L8 2Z" />,
  );
}

/** Like — heart; `filled` renders the viewer-liked state (with danger text color). */
export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  const d =
    "M8 13.5C4.5 10.75 2.5 8.75 2.5 6.25A2.75 2.75 0 0 1 8 4.9a2.75 2.75 0 0 1 5.5 1.35c0 2.5-2 4.5-5.5 7.25Z";
  return base(
    props,
    <path d={d} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} />,
  );
}

/** Share — share-node glyph. */
export function ShareIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="11.75" cy="4" r="1.75" />
      <circle cx="4.25" cy="8" r="1.75" />
      <circle cx="11.75" cy="12" r="1.75" />
      <path d="M5.85 7.1l4.3-2.2" />
      <path d="M5.85 8.9l4.3 2.2" />
    </>,
  );
}

/** Edit — pencil (check-in edit affordances, DG72). */
export function PencilIcon(props: IconProps) {
  return base(props, <path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L4.5 13.5l-3 0.5 0.5-3L11.5 2.5Z" />);
}

/** Overflow — horizontal ellipsis for the own-check-in card menu (DG72). */
export function DotsIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Warning — section-level load failures (DG17 Retry row). */
export function WarningIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M8 2.75L14.5 13h-13L8 2.75Z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.25" r="0.75" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Close — desktop detail column ×. */
export function CloseIcon(props: IconProps) {
  return base(props, <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />);
}

/** Locate — crosshair (onboarding locate button, DG116/DG120). */
export function LocateIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Plus — add-cafe FAB glyph (BRAWUKA-364). */
export function PlusIcon(props: IconProps) {
  return base(props, <path d="M8 3v10M3 8h10" />);
}

/** Menu — three rules (global app-menu trigger, BRAWUKA-504). */
export function MenuIcon(props: IconProps) {
  return base(props, <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />);
}

/** Sun — light theme (app-menu theme row). */
export function SunIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </>,
  );
}

/** Moon — dark theme (app-menu theme row). */
export function MoonIcon(props: IconProps) {
  return base(
    props,
    <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.4 4.4 0 0 0 7 7Z" />,
  );
}

/** Monitor — system theme (app-menu theme row). */
export function MonitorIcon(props: IconProps) {
  return base(
    props,
    <>
      <rect x="2" y="2.5" width="12" height="8.5" rx="1" />
      <path d="M5.5 13.5h5M8 11v2.5" />
    </>,
  );
}

/** Globe — language row (app-menu locale switch). */
export function GlobeIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.25 8h11.5M8 2.25c-3.2 3.4-3.2 8.1 0 11.5M8 2.25c3.2 3.4 3.2 8.1 0 11.5" />
    </>,
  );
}

/** Gear — settings entry (app-menu + settings rows). */
export function GearIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
    </>,
  );
}

/** User — account/profile affordance (app-menu account button). */
export function UserIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 13.5c.8-2.6 2.8-4 5.25-4s4.45 1.4 5.25 4" />
    </>,
  );
}

/** Download — data export row (settings account group). */
export function DownloadIcon(props: IconProps) {
  return base(
    props,
    <path d="M8 2v8M4.75 6.75L8 10l3.25-3.25M2.5 12.5v1h11v-1" />,
  );
}

/** Document — legal page rows (settings legal group). */
export function DocumentIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 1.75h5.5L12 4.25V14.25H4V1.75Z" />
      <path d="M9.25 2v2.5H12" />
    </>,
  );
}

/** Info — about page row (settings legal group). */
export function InfoIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.25v3.5" />
      <circle cx="8" cy="4.75" r="0.75" fill="currentColor" stroke="none" />
    </>,
  );
}

/** SignOut — door + arrow (settings account group). */
export function SignOutIcon(props: IconProps) {
  return base(
    props,
    <path d="M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6.5" />,
  );
}

/** Chevron — settings row affordance (right-pointing). */
export function ChevronRightIcon(props: IconProps) {
  return base(props, <path d="M6 3.5L10.5 8L6 12.5" />);
}
