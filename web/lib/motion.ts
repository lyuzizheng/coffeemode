/**
 * CoffeeMode motion vocabulary — spec 0002.
 *
 * Restrained springs, faster out than in, nothing longer than 450ms in normal
 * flow. Every consumer must respect prefers-reduced-motion — use the
 * `useReducedMotion` hook from framer-motion and the helpers below.
 */
"use client";

import type { Transition } from "framer-motion";
import { useEnterMotion } from "@/hooks/use-enter-motion";

/** Settle budgets (spec 0002): feedback ≤150ms button/toggle/chip settle;
 * state ≤300ms card-expand/drawer settle; transition/slow ≤450ms page/map
 * overlay and onboarding reveal ceilings. Values below sit inside budgets. */
export const duration = {
  /** Button press, toggle, chip select. */
  feedback: 0.12,
  /** Card expand, drawer slide. */
  state: 0.2,
  /** Page transition, map overlay enter. */
  transition: 0.3,
  /** Onboarding, first-load reveal. Hard ceiling. */
  slow: 0.45,
} as const;

/** Easing curves — --ease-default in globals.css is the CSS-side twin. */
export const ease = {
  /** ease-out-quint: fast attack, long settle. The signature curve. */
  default: [0.22, 1, 0.36, 1],
  /** Standard symmetric curve for color/theme cross-fades. */
  smooth: [0.4, 0, 0.2, 1],
  /** Exit curve — decelerating-in feels faster leaving. */
  exit: [0.55, 0.06, 0.68, 0.19],
} as const satisfies Record<string, [number, number, number, number]>;

/** Springs — restrained spec tokens (0002 Motion). No bounce beyond a
 * barely-there overshoot. Behavior unchanged — token + comment promotion
 * only; component migration rides the later motion slice. */
export const spring = {
  /** SPRING-GENTLE — stiffness 260 / damping 30.
     Sheets, drawers, overlays; WorkProfile bars, card reflow, layoutId. */
  gentle: { type: "spring", stiffness: 260, damping: 30 },
  /** SPRING-SNAPPY — stiffness 420 / damping 32, critically damped.
     Small controls (chips, toggles, card press), bottom-sheet detent snap
     + drag velocity pass-through, drawer slides, toggle thumbs. */
  snappy: { type: "spring", stiffness: 420, damping: 32 },
  /** SPRING-SOFT — stiffness 180 / damping 26.
     Atmospheric elements (coffee steam, watermark breathing), first-load
     reveals, work-profile bars. */
  soft: { type: "spring", stiffness: 180, damping: 26 },
} as const satisfies Record<string, Transition>;

/** Card hover/press — the CoffeeMode "alive" feel. Lift a hair, press a hair. */
export const cardInteraction = {
  whileHover: { y: -2, transition: { duration: duration.feedback, ease: ease.default } },
  whileTap: { scale: 0.985, transition: { duration: duration.feedback, ease: ease.default } },
} as const;

export { useEnterMotion };
