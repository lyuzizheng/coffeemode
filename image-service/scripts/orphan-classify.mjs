/**
 * Pure classification + live-keys export parsing for the R2 orphan sweeper
 * (`clean-orphan-originals.mjs`) — no I/O, no env. The scan loop owns
 * LIST/HEAD/DELETE and calls in here to decide what one past-cutoff,
 * HEAD-verified `original/` entry means. Split out for the spec 0009
 * 400-line file budget (BRAWUKA-725).
 */

/**
 * The export artifact contract (BRAWUKA-757) shared with
 * `web/scripts/export-live-image-keys.mjs`. A live-keys file is a COMPLETE
 * export or nothing:
 *
 *   original/11111111-1111-4111-8111-111111111111.webp
 *   …
 *   # live-keys v1 total=<N>
 *
 * One strict key per line (the app's own `original/{uuid}.webp` layout), then
 * a final trailer whose count equals the number of key lines. The trailer is
 * what makes the artifact verifiable: an interrupted or partially written
 * export is a valid prefix of key lines with no trailer — indistinguishable
 * from a complete smaller export without it — so the sweeper refuses any
 * non-empty file that does not parse (fail-closed). An empty file keeps its
 * own meaning (BRAWUKA-632: failed/truncated export, handled by the caller),
 * never "zero live keys".
 */
const LIVE_KEYS_KEY_RE = /^original\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;
const LIVE_KEYS_TRAILER_RE = /^# live-keys v1 total=(\d+)$/;

/**
 * Parse a live-keys export into a Set; throw with a precise reason when the
 * content is not a complete artifact — a malformed line, a missing or
 * mismatched trailer, duplicate keys, or trailing content. Rejecting beats
 * filtering: a silently-dropped line would mark a referenced key as
 * unreferenced and authorize deleting a live photo.
 */
export function parseLiveKeys(raw) {
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const trailer = lines.length > 0 ? LIVE_KEYS_TRAILER_RE.exec(lines[lines.length - 1]) : null;
  if (!trailer) {
    throw new Error("missing or invalid `# live-keys v1 total=<N>` completeness trailer");
  }
  const keyLines = lines.slice(0, -1);
  const total = Number.parseInt(trailer[1], 10);
  if (keyLines.length !== total) {
    throw new Error(`trailer declares total=${total} but the file carries ${keyLines.length} key line(s)`);
  }
  const keys = new Set();
  for (const [index, line] of keyLines.entries()) {
    if (!LIVE_KEYS_KEY_RE.test(line)) {
      throw new Error(`line ${index + 1} is not a valid original/<uuid>.webp key: ${JSON.stringify(line.slice(0, 80))}`);
    }
    if (keys.has(line)) throw new Error(`duplicate key on line ${index + 1}: ${line}`);
    keys.add(line);
  }
  return keys;
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
 * Those reconcile ONLY against a complete, non-empty export
 * (`parseLiveKeys` / `web/scripts/export-live-image-keys.mjs`):
 *   - in the export    → `kept` silently — a live gallery original is the
 *                        normal state, not the attach-leg anomaly that
 *                        `protected` exists to report;
 *   - absent           → `orphan` with `stage:"final"`, swept and co-deleted
 *                        with its `card/` + `thumbnail/` siblings exactly
 *                        like a markerless orphan;
 *   - no / empty export → `held` — a missing or invalid export must never
 *                        authorize deleting a final-marked original
 *                        (fail-closed; an empty file is a failed/truncated
 *                        export per BRAWUKA-632, a malformed one is refused
 *                        before classification per BRAWUKA-757, and
 *                        ALLOW_EMPTY_LIVE_KEYS does not extend to
 *                        final-marked originals).
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
