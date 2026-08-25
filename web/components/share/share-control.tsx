"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@heroui/toast";
import { Button } from "@/components/ui/button";

interface ShareControlProps {
  url: string;
  title: string;
  text?: string;
  variant?: "icon" | "full";
  className?: string;
}

export function ShareControl({
  url,
  title,
  text,
  variant = "icon",
  className,
}: ShareControlProps) {
  const t = useTranslations("share");
  const [canShare, setCanShare] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanShare(true);
    }
  }, []);

  // Listeners close popover on click outside or Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };
    const triggerEl = triggerRef.current;
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      // Return focus to the trigger when the dialog closes via Escape/outside-click.
      triggerEl?.focus();
    };
  }, [popoverOpen]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("copied"), { timeout: 4000 });
    } catch {
      toast(t("failed"), { timeout: 4000 });
    }
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title,
        text: text ?? title,
        url,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Native share failed/unsupported -> fallback to popover
      setPopoverOpen(true);
    }
  };

  const handleShareClick = () => {
    if (canShare) {
      void handleNativeShare();
    } else {
      setPopoverOpen((prev) => !prev);
    }
  };

  const shareTwitter = () => {
    const tweetText = encodeURIComponent(text ?? title);
    const tweetUrl = encodeURIComponent(url);
    window.open(
      `https://twitter.com/intent/tweet?text=${tweetText}&url=${tweetUrl}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div ref={rootRef} className={`relative inline-block ${className ?? ""}`}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("share")}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        onPress={handleShareClick}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
        {variant === "full" && <span className="ml-1.5">{t("share")}</span>}
      </Button>

      {popoverOpen && (
        <div
          role="dialog"
          aria-label={t("share_options")}
          className="absolute right-0 top-full mt-1.5 z-50 min-w-40 rounded-xl bg-surface p-1.5 shadow-xl border border-divider flex flex-col gap-1"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs font-medium"
            onPress={() => {
              void copyLink();
              setPopoverOpen(false);
            }}
          >
            📋 {t("copy_link")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs font-medium"
            onPress={() => {
              shareTwitter();
              setPopoverOpen(false);
            }}
          >
            🐦 {t("share_x")}
          </Button>
        </div>
      )}
    </div>
  );
}
