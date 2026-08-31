"use client";

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";

interface CheckinSliderProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  onClear?: () => void;
  /** Temperature variant: bidirectional with endpoint captions */
  variant?: "default" | "temperature";
  disabled?: boolean;
  /** Show clear × in edit mode when value is set */
  showClear?: boolean;
}

export function CheckinSlider({
  label,
  value,
  onChange,
  onClear,
  variant = "default",
  disabled = false,
  showClear = false,
}: CheckinSliderProps) {
  const t = useTranslations("checkIn");
  const trackRef = useRef<HTMLDivElement>(null);
  const isSet = value !== null;
  const displayValue = isSet ? String(value) : "—";

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || disabled) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const next = Math.round(ratio * 100);
      onChange(next);
    },
    [disabled, onChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setFromClientX(e.clientX);
      // Light haptic on first touch only — not on every pointermove of the drag.
      try {
        navigator.vibrate?.(10);
      } catch {}
      const handleMove = (ev: PointerEvent) => setFromClientX(ev.clientX);
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [setFromClientX, disabled],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const base = value ?? 50;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, base - (e.shiftKey ? 10 : 1)));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(100, base + (e.shiftKey ? 10 : 1)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(100);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span
          className={`font-mono text-sm tabular-nums ${isSet ? "font-medium text-accent" : "text-muted"}`}
          aria-live="polite"
        >
          {displayValue}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div
          ref={trackRef}
          role="slider"
          aria-label={label}
          aria-valuenow={isSet ? value : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={isSet ? String(value) : t("notSet")}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          className={`relative h-7 flex-1 select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            disabled ? "opacity-60" : "cursor-pointer"
          }`}
        >
          {/* Track */}
          <div
            className="absolute inset-y-2 left-0 right-0 rounded-full bg-surface-tertiary"
          />
          {/* Fill */}
          {isSet && (
            <div
              className="absolute inset-y-2 left-0 rounded-full bg-accent transition-[width] duration-75"
              style={{ width: `${value}%` }}
            />
          )}
          {/* Thumb */}
          <div
            className={`absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full border-2 bg-surface shadow-sm transition-[left,transform,opacity] duration-75 ${
              isSet
                ? "border-accent opacity-100"
                : "border-border opacity-50"
            }`}
            style={{ left: isSet ? `calc(${value}% - 14px)` : "0px" }}
          />
        </div>

        {showClear && isSet && onClear && (
          <button
            type="button"
            aria-label={t("clear", { label })}
            onClick={onClear}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {variant === "temperature" && (
        <div className="flex justify-between text-xs text-muted">
          <span className="flex items-center gap-1">
            <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden>
              <path d="M8 2v6m0 0a2 2 0 100 4 2 2 0 000-4z" stroke="currentColor" strokeWidth={1.2} fill="none" strokeLinecap="round" />
              <path d="M3 3l2 2M13 3l-2 2" stroke="currentColor" strokeWidth={1} strokeLinecap="round" opacity={0.6} />
            </svg>
            {t("tooCold")}
          </span>
          <span className="flex items-center gap-1">
            {t("tooHot")}
            <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden>
              <path d="M8 14c2-2 4-4 4-6a4 4 0 10-8 0c0 2 2 4 4 6z" stroke="currentColor" strokeWidth={1.2} fill="none" />
              <path d="M8 10v2" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}
