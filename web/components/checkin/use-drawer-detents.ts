"use client";

import { useRef, useState } from "react";

/**
 * DG70 dual detents for the check-in drawer (artifact §2: opens at content
 * height, drags up to the 92% full-height detent, drags back down, and keeps
 * scrolling at either detent).
 *
 * HeroUI's built-in `useDrawerDrag` is dismiss-only — it clamps the delta to
 * the dismiss direction, so a bottom drawer can never be dragged UP. This
 * hook owns a `Drawer.Handle` gesture that stopPropagation's away from the
 * library handler and drives the dialog's height itself:
 *
 *   drag up    → height grows toward the 92dvh detent
 *   drag down  → height shrinks to the content detent, then the surplus
 *                becomes a downward translate (dismiss gesture)
 *   release    → flick/velocity decides: dismiss, or snap to the nearest
 *                detent with the spec 0002 ease-default curve
 *
 * Dismissal routes through `onRequestClose` (the drawer's `onOpenChange`),
 * so the dirty-draft discard confirm still intercepts it.
 */

/** Mirrors HeroUI's useDrawerDrag constants so the handle gesture feels identical. */
const DRAG_THRESHOLD = 8;
const DISMISS_FRACTION = 0.3;
const VELOCITY_THRESHOLD = 0.5;
/** Spec 0002 `ease.default` (ease-out-quint) as a CSS transition — the JS
 *  motion token cannot reach an inline style string. */
const SNAP_TRANSITION =
  "height 300ms cubic-bezier(0.22, 1, 0.36, 1), transform 300ms cubic-bezier(0.22, 1, 0.36, 1)";

const DIALOG_SELECTOR = '[data-slot="drawer-dialog"]';

interface DetentDrag {
  pointerId: number;
  startY: number;
  /** Dialog height when the gesture began (the detent it started from). */
  startHeight: number;
  /** Natural content height measured with the max-height cap lifted. */
  naturalHeight: number;
  /** 92dvh cap in px. */
  maxHeight: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  active: boolean;
}

export interface DrawerDetents {
  expanded: boolean;
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

export type DetentRelease = "dismiss" | "expand" | "collapse";

/**
 * Pure release decision, exported for tests. `translate` is the downward
 * offset past the content detent; `height` is the dragged dialog height when
 * no translate is in play; `velocity` is px/ms (positive = downward).
 */
export function resolveDetentRelease({
  translate,
  height,
  velocity,
  naturalHeight,
  maxHeight,
}: {
  translate: number;
  height: number;
  velocity: number;
  naturalHeight: number;
  maxHeight: number;
}): DetentRelease {
  if (translate > 0) {
    // Below the content detent the height is already clamped to
    // naturalHeight — the only choices are dismiss or snap back.
    if (translate > naturalHeight * DISMISS_FRACTION || velocity > VELOCITY_THRESHOLD) {
      return "dismiss";
    }
    return "collapse";
  }
  if (velocity < -VELOCITY_THRESHOLD) return "expand";
  if (velocity > VELOCITY_THRESHOLD) return "collapse";
  return height > (naturalHeight + maxHeight) / 2 ? "expand" : "collapse";
}

/** Grow/shrink the dialog along the gesture; surplus downward drag becomes a translate. */
function applyDragMove(dialog: HTMLElement, d: DetentDrag, clientY: number) {
  const dy = clientY - d.startY;
  const now = Date.now();
  const dt = now - d.lastTime;
  if (dt > 0) {
    d.velocity = (clientY - d.lastY) / dt;
    d.lastY = clientY;
    d.lastTime = now;
  }

  if (dy < 0) {
    // Grow toward the 92dvh detent; never past it.
    dialog.style.height = `${Math.min(d.startHeight - dy, d.maxHeight)}px`;
    dialog.style.transform = "";
    return;
  }
  // Shrink to the content detent first; the surplus translates down.
  const shrink = Math.max(0, d.startHeight - d.naturalHeight);
  dialog.style.height = `${d.startHeight - Math.min(dy, shrink)}px`;
  const translate = Math.max(0, dy - shrink);
  dialog.style.transform = translate > 0 ? `translateY(${translate}px)` : "";
}

/** Snap to a detent, then hand the resting height back to CSS so the dialog
 *  keeps tracking viewport (92dvh) and content (auto) changes. */
function snapToDetent(
  dialog: HTMLElement,
  d: DetentDrag,
  release: DetentRelease,
  setExpanded: (v: boolean) => void,
) {
  const nextExpanded = release === "expand";
  dialog.style.transition = SNAP_TRANSITION;
  dialog.style.transform = "";
  dialog.style.height = `${nextExpanded ? d.maxHeight : d.naturalHeight}px`;
  dialog.addEventListener(
    "transitionend",
    () => {
      dialog.style.transition = "";
      dialog.style.height = "";
    },
    { once: true },
  );
  setExpanded(nextExpanded);
}

/** Release/cancel: decide dismiss vs detent snap and settle the dialog. */
function finishDrag(
  e: React.PointerEvent<HTMLElement>,
  d: DetentDrag,
  cancelled: boolean,
  setExpanded: (v: boolean) => void,
  onRequestClose: () => void,
) {
  e.stopPropagation();
  const dialog = e.currentTarget.closest<HTMLElement>(DIALOG_SELECTOR);
  if (!dialog) return;

  const transform = dialog.style.transform;
  const translate = transform.startsWith("translateY(")
    ? Number.parseFloat(transform.slice(11)) || 0
    : 0;
  const release = cancelled
    ? d.startHeight > d.naturalHeight + 1
      ? "expand"
      : "collapse"
    : resolveDetentRelease({
        translate,
        height: dialog.offsetHeight,
        velocity: d.velocity,
        naturalHeight: d.naturalHeight,
        maxHeight: d.maxHeight,
      });

  if (release === "dismiss") {
    // Restore rest geometry before closing: if the discard confirm
    // intercepts, the drawer sits settled behind it instead of frozen
    // mid-drag.
    dialog.style.transition = "none";
    dialog.style.transform = "";
    dialog.style.height = "";
    onRequestClose();
    return;
  }
  snapToDetent(dialog, d, release, setExpanded);
}

/** Gesture start: measure both detents (content height needs the cap lifted
 *  for one read) and capture the pointer on the handle. */
function beginDrag(e: React.PointerEvent<HTMLElement>, dragRef: React.RefObject<DetentDrag | null>) {
  if (e.button !== 0) return;
  // Keep HeroUI's dismiss-only drag out of this gesture entirely.
  e.stopPropagation();
  const dialog = e.currentTarget.closest<HTMLElement>(DIALOG_SELECTOR);
  if (!dialog) return;

  const startHeight = dialog.offsetHeight;
  dialog.style.height = "auto";
  dialog.style.maxHeight = "none";
  const naturalHeight = dialog.offsetHeight;
  dialog.style.maxHeight = "";
  dialog.style.height = `${startHeight}px`;

  dragRef.current = {
    pointerId: e.pointerId,
    startY: e.clientY,
    startHeight,
    naturalHeight,
    maxHeight: window.innerHeight * 0.92,
    lastY: e.clientY,
    lastTime: Date.now(),
    velocity: 0,
    active: false,
  };
  e.currentTarget.setPointerCapture(e.pointerId);
}

export function useDrawerDetents({
  isOpen,
  onRequestClose,
}: {
  isOpen: boolean;
  onRequestClose: () => void;
}): DrawerDetents {
  const [expanded, setExpanded] = useState(false);
  // The in-flight gesture lives in a ref: it is written and read only inside
  // pointer callbacks, never during render.
  const dragRef = useRef<DetentDrag | null>(null);

  // A fresh open always starts at the content detent — reset during render,
  // not in an effect, so the first painted frame is never stale.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setExpanded(false);
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => beginDrag(e, dragRef);

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const dialog = e.currentTarget.closest<HTMLElement>(DIALOG_SELECTOR);
    if (!dialog) return;

    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
      dialog.style.transition = "none";
    }
    applyDragMove(dialog, d, e.clientY);
  };

  const onFinish = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || e.pointerId !== d.pointerId || !d.active) return;
    finishDrag(e, d, cancelled, setExpanded, onRequestClose);
  };

  return {
    expanded,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => onFinish(e, false),
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => onFinish(e, true),
    },
  };
}
