"use client";

import { useEffect, useState } from "react";

/**
 * 300ms count-up hook for stats (profile-page-v1 §2).
 * Respects prefers-reduced-motion by rendering the final target value immediately.
 */
export function useCountUp(target: number, durationMs: number = 300): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || target <= 0) {
      return;
    }
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) {
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }

    const startVal = 0;
    const startTime = performance.now();
    let frameId: number;

    const tick = (timestamp?: number) => {
      const now = typeof timestamp === "number" && timestamp >= startTime ? timestamp : performance.now();
      const elapsed = Math.max(0, now - startTime);
      const progress = Math.min(1, elapsed / durationMs);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startVal + (target - startVal) * eased));

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, durationMs]);

  return value;
}
