/**
 * CoffeeMode motion vocabulary — spec 0002.
 *
 * Restrained springs, faster out than in, nothing longer than 450ms in normal
 * flow. Every consumer must respect prefers-reduced-motion — use the
 * `useReducedMotion` hook from framer-motion and the helpers below.
 */
import type { Transition, Variants } from "framer-motion";

/** Durations in seconds — mirror of spec tokens (feedback/state/transition/slow). */
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

/** Springs — restrained. No bounce beyond a barely-there overshoot. */
export const spring = {
  /** Sheets, drawers, overlays. */
  gentle: { type: "spring", stiffness: 260, damping: 30 },
  /** Small controls: chips, toggles, card press. */
  snappy: { type: "spring", stiffness: 420, damping: 32 },
  /** First-load reveals, work-profile bars. */
  soft: { type: "spring", stiffness: 180, damping: 26 },
} as const satisfies Record<string, Transition>;

/** Card hover/press — the CoffeeMode "alive" feel. Lift a hair, press a hair. */
export const cardInteraction = {
  whileHover: { y: -2, transition: { duration: duration.feedback, ease: ease.default } },
  whileTap: { scale: 0.985, transition: { duration: duration.feedback, ease: ease.default } },
} as const;

/** Enter slower than exit — never the reverse. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.transition, ease: ease.default },
  },
  exit: {
    opacity: 0,
    y: 8,
    transition: { duration: duration.feedback, ease: ease.exit },
  },
};

/** Staggered container for lists — 40ms between children, snappy reveal. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

/**
 * Reduced-motion helper: returns props that skip animation entirely when the
 * user prefers reduced motion. Spread onto motion components:
 *   <motion.div {...respectMotion(reduced, { initial: "hidden", animate: "visible" })} />
 */
export function respectMotion<T extends Record<string, unknown>>(
  reduced: boolean | null,
  props: T,
): T | Record<string, never> {
  return reduced ? {} : props;
}
