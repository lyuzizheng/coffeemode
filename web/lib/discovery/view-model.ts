/**
 * Discovery view-model — pure derivations from CafeSummary/WorkStats for the
 * sheet surfaces. No I/O, no server-only: unit-testable in isolation and
 * shared by the mobile sheet and the desktop sidebar/detail column.
 */
import type { CafeSummary } from "@/types/cafes";
import type { WorkStats } from "@/lib/stats/work-stats";
import type { CheckInFeedPage, PublicCheckIn } from "@/types/checkins";

/** Characteristic fact kinds in fixed PEEK priority order (artifact §2). */
export const FACT_PRIORITY = ["wifi", "outlets", "stay", "seats", "temp", "coffee"] as const;
export type FactKind = (typeof FACT_PRIORITY)[number];

export interface Fact {
  kind: FactKind;
  /** Score facts render the integer mean; stay renders the policy label. */
  value: string;
}

/** Mean of a work dimension, rounded for display; null when no responses. */
export function dimMean(stats: WorkStats, dim: keyof WorkStats["dims"]): number | null {
  const d = stats.dims[dim];
  if (!d || d.n === 0) return null;
  return Math.round(d.sum / d.n);
}

/** Consensus policy = the answer with the most responses; null when none. */
export function policyConsensus(
  stats: WorkStats,
  policy: keyof WorkStats["policies"],
): string | null {
  const counts = stats.policies[policy];
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Up to 4 characteristic facts for a cafe, in artifact priority order
 * (wifi → outlets → stay → seats → temp → coffee). Missing data collapses —
 * never a placeholder, never a zero (DG10/§2). Score facts carry the integer
 * mean as text; the stay fact carries the raw max_stay consensus key so the
 * component can translate/abbreviate it ("peak" vs "3h" vs "∞").
 */
export function cafeFacts(cafe: CafeSummary, max = 4): Fact[] {
  const facts: Fact[] = [];
  const pushScore = (kind: Exclude<FactKind, "stay">) => {
    const mean = dimMean(cafe.work_stats, kind);
    if (mean !== null) facts.push({ kind, value: String(mean) });
  };
  for (const kind of FACT_PRIORITY) {
    if (facts.length >= max) break;
    if (kind === "stay") {
      const consensus = policyConsensus(cafe.work_stats, "max_stay");
      // "unknown" is an honest FULL chip, not a PEEK fact.
      if (consensus && consensus !== "unknown") {
        facts.push({ kind: "stay", value: consensus });
      }
    } else {
      pushScore(kind);
    }
  }
  return facts;
}

/** Meters → display km string with one decimal ("1.2"); null when unknown. */
export function formatDistanceKm(distanceM: number | undefined | null): string | null {
  if (typeof distanceM !== "number" || !Number.isFinite(distanceM)) return null;
  return (distanceM / 1000).toFixed(1);
}

/**
 * Flatten feed pages and deduplicate by check-in id (first occurrence wins) —
 * likes may move a row between requests, so the same check-in can appear on
 * two consecutive pages (spec 0001, DG17 best-effort pagination).
 */
export function dedupeCheckins(pages: CheckInFeedPage[]): PublicCheckIn[] {
  const seen = new Set<string>();
  const out: PublicCheckIn[] = [];
  for (const page of pages) {
    for (const checkin of page.checkins) {
      if (seen.has(checkin.id)) continue;
      seen.add(checkin.id);
      out.push(checkin);
    }
  }
  return out;
}
