"use client";

/**
 * Mobile discovery sheet (artifact §5, DG14/DG15/DG75).
 *
 * One bespoke Framer Motion sheet, three detents: PEEK (card strip, no
 * selection), HALF (content-adaptive up to 50dvh — BRAWUKA-248), FULL
 * (85dvh — the map stays visible ~15% at top). Geometry uses dvh +
 * env(safe-area-inset-bottom) per the spec 0002 viewport contract.
 * Drag/scroll ownership (spec 0004 18c): only the
 * handle/header zone drags the sheet; detail content scrolls natively and
 * hands a downward pull back to the sheet only at scroll-top. Downward
 * gestures step FULL → HALF → PEEK one detent per gesture (18b); stepping
 * into PEEK clears the selection. Reduced-motion users get instant snaps.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useDragControls, useMotionValue, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { cardInteraction, spring } from "@/lib/motion";
import { useMounted } from "@/hooks/use-mounted";
import type { DiscoveryController, SheetSnap } from "@/lib/discovery/use-discovery-controller";
import type { CafeSummary } from "@/types/cafes";
import { CafeCardBody } from "./cafe-card";
import { DetailContent } from "./detail-content";
import { InlineError } from "./inline-error";

/** Visible sheet height at PEEK (px) — cover row + padding; safe-area is padded inside. */
const PEEK_VISIBLE_PX = 172;
const SHEET_HEIGHT_VH = 0.85;
const HALF_VISIBLE_VH = 0.5;
/** Handle chrome above the content column: pt-2 + 4px bar + pb-3. */
const HANDLE_VISIBLE_PX = 24;
/** Drag distance/velocity that commits a detent step. */
const STEP_OFFSET_PX = 60;
const STEP_VELOCITY = 300;

function PeekCard({
  cafe,
  active,
  onSelect,
  cardRef,
}: {
  cafe: CafeSummary;
  active: boolean;
  onSelect: () => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      ref={(el) => cardRef(el)}
      type="button"
      onClick={onSelect}
      // ~85% width on phones; clamp(280px,55%,420px) on tablet (§8).
      className="w-[85%] shrink-0 snap-center text-left md:w-[clamp(280px,55%,420px)]"
      // Active card scales ~1.02, neighbors dim (§8) — gentle spring, no CSS
      // tween; instant under reduced motion.
      initial={false}
      animate={active ? cardInteraction.active : cardInteraction.inactive}
      transition={reduced ? { duration: 0 } : spring.gentle}
    >
      <CafeCardBody cafe={cafe} />
    </motion.button>
  );
}

function PeekSkeletons() {
  return (
    <div className="flex gap-3 px-4" aria-hidden>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex w-[85%] shrink-0 gap-3 rounded-md border border-separator bg-surface p-3 md:w-[clamp(280px,55%,420px)]"
        >
          <div className="h-[66px] w-[88px] animate-pulse rounded-md bg-surface-tertiary" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tertiary" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tertiary" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-tertiary" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PeekStrip({
  cafes,
  isLoading,
  isError,
  onRetry,
  controller,
  addCafe,
}: {
  cafes: CafeSummary[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  controller: DiscoveryController;
  addCafe: ReactNode;
}) {
  const t = useTranslations("discovery");
  const [activeIndex, setActiveIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement | null>(null);

  if (isLoading) return <PeekSkeletons />;
  // BRAWUKA-231: a failed fetch must not masquerade as "no cafes nearby".
  if (isError && cafes.length === 0) {
    return (
      <div className="px-4 pb-2">
        <InlineError message={t("nearby_load_failed")} onRetry={onRetry} />
      </div>
    );
  }
  if (cafes.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 pb-2">
        <p className="font-display text-lg font-bold text-foreground">{t("empty_nearby_title")}</p>
        <p className="text-sm text-muted">{t("empty_nearby_body")}</p>
        {addCafe}
      </div>
    );
  }

  const onScroll = () => {
    const el = stripRef.current;
    const card = el?.querySelector<HTMLElement>(":scope > *");
    if (!el || !card) return;
    const step = card.offsetWidth + 12; // gap-3
    if (step > 0) setActiveIndex(Math.round(el.scrollLeft / step));
  };

  return (
    <div
      ref={stripRef}
      onScroll={onScroll}
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1"
      aria-label={t("peek_aria")}
    >
      {cafes.map((cafe, i) => (
        <PeekCard
          key={cafe.id}
          cafe={cafe}
          active={i === activeIndex}
          onSelect={() => controller.select(cafe.id)}
          cardRef={(el) => controller.registerCardRef(cafe.id, el)}
        />
      ))}
    </div>
  );
}

export function MobileSheet({
  controller,
  cafes,
  isLoading,
  isError,
  onRetry,
  onCheckIn,
  addCafe,
}: {
  controller: DiscoveryController;
  cafes: CafeSummary[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onCheckIn: (cafeId?: string, cafeName?: string) => void;
  addCafe: ReactNode;
}) {
  const t = useTranslations("discovery");
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const [viewportH, setViewportH] = useState(0);
  const y = useMotionValue(0);
  const dragControls = useDragControls();
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Inner wrapper whose natural height the HALF detent adapts to. */
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  /** Natural HALF content height (px); null until measured → HALF = 50dvh. */
  const [contentH, setContentH] = useState<number | null>(null);
  /** True while a sheet drag is in flight; the snap effect must not fight it. */
  const dragging = useRef(false);
  const pendingPull = useRef<{ startY: number } | null>(null);
  /** Drag-end velocity handed to the detent snap spring (velocity transfer). */
  const snapVelocity = useRef(0);

  const { snap, selectedCafeId } = controller;

  useEffect(() => {
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // BRAWUKA-248: HALF is content-adaptive — visible height clamps to
  // [PEEK + handle, content + handle, 50dvh]. The floor keeps HALF strictly
  // above PEEK so the detent order never degenerates; the snap set stays
  // fixed at PEEK/HALF/FULL — only HALF's rendered height tightens.
  const halfVisible =
    contentH === null
      ? viewportH * HALF_VISIBLE_VH
      : Math.min(
          viewportH * HALF_VISIBLE_VH,
          Math.max(PEEK_VISIBLE_PX + HANDLE_VISIBLE_PX, contentH + HANDLE_VISIBLE_PX),
        );
  const sheetH = viewportH * SHEET_HEIGHT_VH;
  const offsets: Record<SheetSnap, number> = {
    full: 0,
    half: sheetH - halfVisible,
    peek: sheetH - PEEK_VISIBLE_PX,
  };
  const targetY = offsets[snap];

  // Measure the HALF content column's natural height so the detent can hug
  // it. The callback ref re-fires whenever the column mounts/remounts (first
  // render is gated on viewportH, and PEEK swaps the subtree). jsdom has no
  // ResizeObserver; unmeasured content keeps the 50dvh ceiling, which is
  // also the pre-measurement default.
  useEffect(() => {
    if (!contentEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContentH(contentEl.offsetHeight));
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [contentEl]);

  // Snap state changes animate the sheet; reduced motion snaps instantly (18e).
  // Detent snaps ride the snappy spring; a drag's release velocity carries
  // into the snap so a flick lands with its own momentum (spec 0002 Motion).
  useEffect(() => {
    if (viewportH === 0 || dragging.current) return;
    const velocity = snapVelocity.current;
    snapVelocity.current = 0;
    const controls = animate(
      y,
      targetY,
      reduced ? { duration: 0 } : { ...spring.snappy, velocity },
    );
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetY, reduced]);

  if (!mounted || viewportH === 0) return null;

  const onDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    dragging.current = false;
    const steps: SheetSnap[] = selectedCafeId ? ["peek", "half", "full"] : ["peek"];
    const current = steps.indexOf(snap);
    let next = current;
    if (info.velocity.y > STEP_VELOCITY || info.offset.y > STEP_OFFSET_PX) next = current - 1;
    else if (info.velocity.y < -STEP_VELOCITY || info.offset.y < -STEP_OFFSET_PX) next = current + 1;
    next = Math.max(0, Math.min(steps.length - 1, next));
    const target = steps[next];
    if (target !== snap) {
      // Hand the release velocity to the detent snap spring before the snap
      // state flips; the snap effect consumes and clears it.
      snapVelocity.current = info.velocity.y;
      // Stepping into PEEK clears the selection (18b) — controller.snapTo handles it.
      controller.snapTo(target);
    } else {
      animate(y, offsets[snap], reduced ? { duration: 0 } : spring.snappy);
    }
  };

  // DG15 scroll handoff: a downward pull starts dragging the sheet only when
  // the content is scrolled to its top.
  const onContentPointerDown = (e: React.PointerEvent) => {
    if (contentRef.current && contentRef.current.scrollTop <= 0) {
      pendingPull.current = { startY: e.clientY };
    }
  };
  const onContentPointerMove = (e: React.PointerEvent) => {
    const pending = pendingPull.current;
    if (pending && e.clientY - pending.startY > 8) {
      dragControls.start(e);
      pendingPull.current = null;
    }
  };
  const clearPendingPull = () => {
    pendingPull.current = null;
  };

  return (
    <motion.div
      style={{ y, height: "85dvh", paddingBottom: "env(safe-area-inset-bottom)" }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: offsets.peek }}
      dragElastic={0.08}
      dragMomentum={false}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragEnd={onDragEnd}
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-lg border-t border-separator bg-overlay shadow-lg"
      role="region"
      aria-label={t("sheet_aria")}
    >
      <div
        onPointerDown={(e) => dragControls.start(e)}
        className="flex shrink-0 cursor-grab touch-none justify-center pb-3 pt-2 active:cursor-grabbing"
        aria-label={t("sheet_handle_aria")}
      >
        <span className="h-1 w-9 rounded-full bg-separator" aria-hidden />
      </div>

      {snap === "peek" || !selectedCafeId ? (
        <PeekStrip
          cafes={cafes}
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
          controller={controller}
          addCafe={addCafe}
        />
      ) : (
        <div
          ref={contentRef}
          onPointerDown={onContentPointerDown}
          onPointerMove={onContentPointerMove}
          onPointerUp={clearPendingPull}
          onPointerCancel={clearPendingPull}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div ref={setContentEl}>
            <DetailContent
              key={selectedCafeId}
              cafeId={selectedCafeId}
              variant={snap}
              controller={controller}
              onCheckIn={onCheckIn}
              distanceM={cafes.find((c) => c.id === selectedCafeId)?.distance_m}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
