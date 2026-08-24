/**
 * CoffeeMode bespoke icon set (discovery-sheet artifact §2, resolves DG6).
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
