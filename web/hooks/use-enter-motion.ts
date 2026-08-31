"use client";

import { useReducedMotion } from "framer-motion";
import { useMounted } from "@/hooks/use-mounted";

/**
 * Hydration-safe gate for enter animations.
 *
 * `useReducedMotion()` reads a media query that exists only in the browser:
 * the server renders "no preference" while a reduced-motion client hydrates
 * with `true` — and any `initial={{ opacity: 0 }}` on the server HTML becomes
 * a hydration mismatch. This hook returns false on the server AND on the
 * first client render (both match), true only after mount when the user
 * allows motion.
 *
 * Usage: render the motion component with a `key` flip so framer-motion
 * re-mounts it and applies `initial` when the gate opens:
 *
 *   const enter = useEnterMotion();
 *   <motion.div key={enter ? "m" : "s"} {...(enter ? { initial, animate, transition } : { initial: false })} />
 */
export function useEnterMotion(): boolean {
  const reduced = useReducedMotion();
  const mounted = useMounted();
  return mounted && !reduced;
}
