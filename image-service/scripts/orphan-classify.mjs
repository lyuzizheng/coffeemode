/**
 * Pure classification helpers for the R2 orphan sweeper
 * (`clean-orphan-originals.mjs`) — no I/O, no env. The scan loop owns
 * LIST/HEAD/DELETE and calls in here to decide what one past-cutoff,
 * HEAD-verified `original/` entry means. Split out for the spec 0009
 * 400-line file budget (BRAWUKA-725).
 */

/**
 * Decode an S3 ListObjectsV2 `<Key>` value (BRAWUKA-592): keys arrive
 * XML-escaped, not percent-encoded — decode entities + numeric refs in one
 * pass so `&amp;lt;` stays a literal `&lt;`, never `<`.
 */
export function unescapeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#[xX]([0-9a-fA-F]+);/g, (m, named, dec, hex) => {
    if (named) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named];
    const cp = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (!Number.isSafeInteger(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    return String.fromCodePoint(cp);
  });
}

/**
 * Derived siblings for one orphan original (BRAWUKA-699): the worker keys
 * every variant as `<prefix>/<uuid>.webp`, so `original/<uuid>.webp` implies
 * `card/` + `thumbnail/`. Non-`original/` input yields none (fail-closed).
 */
export function variantKeysForOriginal(key) {
  const match = /^original\/(.+)\.webp$/.exec(key);
  if (!match) return [];
  return [`card/${match[1]}.webp`, `thumbnail/${match[1]}.webp`];
}

/**
 * Decide what one past-cutoff, HEAD-verified `original/` entry is (BRAWUKA-725):
 * `{ action: "orphan" | "protected" | "kept" | "held", candidate? }`.
 *
 * Markerless / `provision` (never attached, BRAWUKA-400) keep the marker-based
 * contract, gated by the live-keys export: referenced → `protected` (attach
 * retry outstanding — reported as would-keep, never deleted); absent →
 * `orphan`; no export → `orphan` with `verification:"unverified"` (the
 * documented marker-based behavior).
 *
 * Final-marked (`targetType=cafe|checkin`) markers prove attachment, not
 * liveness: once the row is tombstoned and the post-commit delete leg failed
 * (storage outage), the marker survives while no live row references the key.
 * Those reconcile ONLY against a non-empty export (`web/scripts/export-live-image-keys.mjs`):
 *   - in the export    → `kept` silently — a live gallery original is the
 *                        normal state, not the attach-leg anomaly that
 *                        `protected` exists to report;
 *   - absent           → `orphan` with `stage:"final"`, swept and co-deleted
 *                        with its `card/` + `thumbnail/` siblings exactly
 *                        like a markerless orphan;
 *   - no / empty export → `held` — a missing or invalid export must never
 *                        authorize deleting a final-marked original
 *                        (fail-closed; an empty file is a failed/truncated
 *                        export per BRAWUKA-632, and ALLOW_EMPTY_LIVE_KEYS
 *                        does not extend to final-marked originals).
 *
 * `candidate` carries the dry-run report fields: `stage` ∈ `markerless` |
 * `provision` | `final`; `verification` ∈ `referenced` | `not-referenced` |
 * `unverified` (BRAWUKA-592/BRAWUKA-630 — `referenced` appears only on
 * `protected` entries).
 */
export function classifyOriginal({ key, size, lastModified, targetType, liveKeys }) {
  const finalMarked = Boolean(targetType) && targetType !== "provision";
  if (finalMarked) {
    if (!liveKeys || liveKeys.size === 0) return { action: "held" };
    if (liveKeys.has(key)) return { action: "kept" };
    return {
      action: "orphan",
      candidate: { key, size, lastModified, stage: "final", verification: "not-referenced" },
    };
  }
  const referenced = liveKeys?.has(key) ?? false;
  const verification = liveKeys ? (referenced ? "referenced" : "not-referenced") : "unverified";
  return {
    action: referenced ? "protected" : "orphan",
    candidate: {
      key,
      size,
      lastModified,
      stage: targetType === "provision" ? "provision" : "markerless",
      verification,
    },
  };
}
