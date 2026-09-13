"use client";

/**
 * Check-in note prose card (spec 0002 §Editorial Surfaces, BRAWUKA-73).
 *
 * Shared narrative rendering for check-in notes (≤500 chars): `--font-serif`
 * editorial prose (≥1rem via `text-prose`, measure capped at 68ch) with a
 * `--font-mono` telemetry-style toggle. Longer notes use plain expandable
 * progressive disclosure — no parallax, no marginalia ornament, no footnote
 * flourishes. Empty/whitespace-only notes render nothing (no container, no
 * placeholder). Utility chrome rule: never reuse this component on sheets,
 * forms, buttons, or search surfaces.
 */
import { useId, useState } from "react";
import { useTranslations } from "next-intl";

/** Notes longer than this collapse behind a plain show more/less toggle. */
export const CHECKIN_NOTE_COLLAPSE_AT = 240;

export function CheckinNote({ note }: { note: string }) {
  const t = useTranslations("checkIn");
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  const text = note.trim();
  if (!text) return null;

  const collapsible = text.length > CHECKIN_NOTE_COLLAPSE_AT;
  const visible =
    collapsible && !expanded
      ? `${text.slice(0, CHECKIN_NOTE_COLLAPSE_AT).replace(/\s+\S*$/, "")}…`
      : text;

  return (
    <div className="min-w-0 max-w-[68ch]">
      <p id={bodyId} className="font-serif text-prose text-pretty text-foreground">
        {visible}
      </p>
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((v) => !v)}
          className="cm-focus -my-3 mt-1 inline-flex min-h-11 items-center font-mono text-xs text-muted underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {expanded ? t("noteShowLess") : t("noteShowMore")}
        </button>
      )}
    </div>
  );
}
