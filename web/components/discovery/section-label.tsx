/**
 * Section label — the dossier's print-style section marker (BRAWUKA-364).
 * Small-caps mono label + a hairline rule that fills the remaining width.
 * Server-safe (no client hooks) so the SSR cafe shell can use it too.
 */
import type { ReactNode } from "react";

export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  /** Optional right-aligned control (e.g. the feed mode tabs). */
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="shrink-0 font-mono text-xs font-medium uppercase tracking-[0.14em] text-muted">
        {children}
      </h3>
      <span aria-hidden className="h-px min-w-6 flex-1 bg-separator" />
      {action}
    </div>
  );
}
