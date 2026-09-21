"use client";

/**
 * The single settings row primitive (BRAWUKA-504): label + optional
 * description + a control or a chevron link. Every settings entry renders
 * through this — a new preference is a new row, never a new layout.
 *
 * Three shapes:
 * - `href` set → the whole row is a Link with a trailing chevron.
 * - `downloadHref` set → the whole row is a plain `<a download>` with a
 *   download glyph. Never a `next/link`: prefetch would fire the export
 *   route before the user taps (BRAWUKA-577).
 * - `control` set → label/description left, control right (rows that carry
 *   their own labelled control, like the ranking toggle, pass `children`
 *   instead and span the full width).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon, DownloadIcon } from "@/components/icons";

export function SettingsRow({
  label,
  description,
  control,
  href,
  downloadHref,
  danger = false,
  children,
}: {
  label?: string;
  description?: string;
  /** Right-aligned interactive control (segmented picker, button…). */
  control?: ReactNode;
  /** Navigation row — renders as a Link with a chevron affordance.
   * Mutually exclusive with `downloadHref` (href wins if both are set —
   * no caller does this). */
  href?: string;
  /** Download row — plain `<a download>`, no router prefetch. */
  downloadHref?: string;
  /** Danger styling on the label (destructive account actions). */
  danger?: boolean;
  /** Full-width custom row content (self-labelled controls). */
  children?: ReactNode;
}) {
  if (children) {
    return <div className="px-4 py-3">{children}</div>;
  }

  const text = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-sm ${danger ? "font-medium text-danger" : "text-foreground"}`}
        >
          {label}
        </span>
        {description ? (
          <span className="text-xs leading-relaxed text-muted">
            {description}
          </span>
        ) : null}
      </span>
      {control}
      {href ? (
        <ChevronRightIcon size={14} className="shrink-0 text-muted" />
      ) : null}
      {downloadHref ? (
        <DownloadIcon size={14} className="shrink-0 text-muted" />
      ) : null}
    </>
  );

  const className =
    "cm-focus flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-120 hover:bg-surface-secondary";

  if (href) {
    return (
      <Link href={href} className={className}>
        {text}
      </Link>
    );
  }
  if (downloadHref) {
    return (
      <a href={downloadHref} download className={className}>
        {text}
      </a>
    );
  }
  return <div className={className}>{text}</div>;
}

/** Grouped card wrapper — the spec 0002 radius-md grouped-list surface. */
export function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted">{label}</h2>
      <div className="divide-y divide-separator rounded-md border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}
