"use client";


/**
 * Navigation return prompt (navigation-prompt slice, #149; design
 * docs/design/navigation-prompt-v1.md, DG76–DG93).
 *
 * A friendly tap on the shoulder on a LATER day: "有去 {cafe} 喝一杯吗？"
 * with three honest exits — 有去！ / 还没去 / 不去了 — and no × anywhere
 * (DG81). After 8s untouched the card morphs into a pill that stays until
 * answered (DG88); interacting pauses the timer (DG28). One prompt per
 * session (sessionStorage flag), fetched lazily off the critical render
 * path (DG77), deferred while the sheet is at FULL or a modal task surface
 * is open (DG85/DG90 — the host gates `enabled`).
 * `useNavPrompt` (./use-nav-prompt.ts) owns the fetch/answer state;
 * `NavPromptView` is the presentational card↔pill pair rendered by the
 * host surface (inside the mobile sheet so it tracks drags, fixed
 * bottom-center on desktop, DG84).
 */
import { useEffect, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Button } from "@heroui/react";
import { CoffeeIcon, NavigationIcon } from "@/components/icons";
import { getNavPromptCollapseMs } from "@/lib/client-env";
import { spring } from "@/lib/motion";
import type { NavPromptAnswer, NavPromptItem } from "./use-nav-prompt";

export type { NavPromptAnswer, NavPromptItem } from "./use-nav-prompt";

/** Relative-day label for the context line: 昨天 / N 天前. */
function useDayLabel(createdAt: string): string {
  const t = useTranslations("navPrompt");
  // Computed once at mount — the label is a snapshot of when the prompt
  // appeared, not a live clock.
  const [days] = useState(() =>
    Math.max(1, Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000)),
  );
  return days <= 1 ? t("day_yesterday") : t("day_count", { count: days });
}

/** The three honest exits (DG81): primary visited, ghost not-yet, muted wont-go. */
function PromptOptions({
  pending,
  onAnswer,
}: {
  pending: NavPromptAnswer | null;
  onAnswer: (outcome: NavPromptAnswer) => void;
}) {
  const t = useTranslations("navPrompt");
  return (
    <div className="mt-3 flex items-center gap-2">
      <Button
        variant="primary"
        className="flex-1 rounded-sm"
        isDisabled={pending !== null}
        onPress={() => onAnswer("visited")}
      >
        {t("yes")}
      </Button>
      <Button
        variant="ghost"
        className="rounded-sm"
        isDisabled={pending !== null}
        onPress={() => onAnswer("not_yet")}
      >
        {t("notYet")}
      </Button>
      <Button
        variant="ghost"
        className="rounded-sm text-muted"
        isDisabled={pending !== null}
        onPress={() => onAnswer("wont_go")}
      >
        {t("wontGo")}
      </Button>
    </div>
  );
}

/** The collapsed pill (DG88): stays until answered, re-expands on tap. */
function PromptPill({ onExpand }: { onExpand: () => void }) {
  const t = useTranslations("navPrompt");
  const reduced = useReducedMotion();
  return (
    <motion.button
      layoutId="nav-prompt"
      type="button"
      onClick={onExpand}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={spring.gentle}
      className="pointer-events-auto flex h-9 w-fit items-center gap-1.5 self-end rounded-full border border-separator bg-overlay px-3 text-xs text-foreground shadow-map"
    >
      <NavigationIcon size={14} />
      {t("pill")}
    </motion.button>
  );
}

/** The prompt card: cover, headline + context, three honest exits (DG81). */
function PromptCard({
  item,
  pending,
  onAnswer,
  wide,
  onPauseChange,
}: {
  item: NavPromptItem;
  pending: NavPromptAnswer | null;
  onAnswer: (outcome: NavPromptAnswer) => void;
  /** Desktop surface placement centers at 360px (DG84). */
  wide: boolean;
  onPauseChange: (paused: boolean) => void;
}) {
  const t = useTranslations("navPrompt");
  const reduced = useReducedMotion();
  const day = useDayLabel(item.created_at);
  const pause = () => onPauseChange(true);
  const resume = () => onPauseChange(false);
  return (
    <motion.div
      layoutId="nav-prompt"
      role="status"
      initial={reduced ? false : { y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={spring.snappy}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onPointerDown={pause}
      onPointerUp={resume}
      onPointerCancel={resume}
      className={
        "pointer-events-auto rounded-lg border border-separator bg-overlay p-3 shadow-lg " +
        (wide ? "mx-auto w-[360px] max-w-full" : "w-full")
      }
    >
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-separator bg-surface-tertiary">
          {item.cafe.cover ? (
            <Image
              src={item.cafe.cover}
              alt=""
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted">
              <CoffeeIcon size={20} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">
            {t("headline", { cafe: item.cafe.name })}
          </p>
          <p className="mt-0.5 text-xs text-muted">{t("context", { day })}</p>
        </div>
      </div>
      <PromptOptions pending={pending} onAnswer={onAnswer} />
    </motion.div>
  );
}

export function NavPromptView({
  item,
  pending,
  onAnswer,
  placement,
}: {
  item: NavPromptItem;
  pending: NavPromptAnswer | null;
  onAnswer: (outcome: NavPromptAnswer) => void;
  /** "sheet": absolute above the mobile sheet (tracks drags, 12px gap).
      "surface": fixed bottom-center card / bottom-right pill (desktop, DG84). */
  placement: "sheet" | "surface";
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [paused, setPaused] = useState(false);
  const collapseMs = getNavPromptCollapseMs();

  // Spec-owned 8s auto-collapse; hover/focus/touch-hold pauses it (DG28).
  // The pill itself never times out (DG88).
  useEffect(() => {
    if (collapsed || paused) return;
    const timer = window.setTimeout(() => setCollapsed(true), collapseMs);
    return () => window.clearTimeout(timer);
  }, [collapsed, paused, collapseMs]);

  return (
    <LayoutGroup>
      <div
        className={
          placement === "sheet"
            ? "absolute bottom-[calc(100%+12px)] left-3 right-[var(--layout-chrome-offset)] z-10 flex flex-col"
            : "pointer-events-none fixed inset-x-6 bottom-6 z-30 flex flex-col"
        }
      >
        {collapsed ? (
          <PromptPill onExpand={() => setCollapsed(false)} />
        ) : (
          <PromptCard
            item={item}
            pending={pending}
            onAnswer={onAnswer}
            wide={placement === "surface"}
            onPauseChange={setPaused}
          />
        )}
      </div>
    </LayoutGroup>
  );
}
