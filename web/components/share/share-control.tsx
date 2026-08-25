"use client";

/**
 * Share control (spec 0001 §PWA & sharing, DG109, artifact §4).
 *
 * One ghost icon button that does the right thing per context: the native
 * share sheet where the Web Share API exists, a copy-link popover inside
 * WeChat (its in-app browser has no share API — day-one WeChat support),
 * and copy-link everywhere else. Copy link is never a hidden fallback:
 * it is always one tap away. Copy feedback is a toast.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button, toast } from "@heroui/react";
import { ShareIcon } from "@/components/icons";
import { buildShareData, isWeChatUserAgent } from "@/lib/share";

// The UA never changes within a session: a no-op subscription is enough for
// useSyncExternalStore. Server snapshot is false (no navigator), so SSR
// renders the generic share path and the client settles on the real value
// at hydration without a state-in-effect write.
const subscribeNoop = () => () => {};
const readIsWeChat = () => isWeChatUserAgent(navigator.userAgent);

export function ShareControl({
  url,
  title,
}: {
  /** Absolute canonical URL to share. */
  url: string;
  /** Cafe name — native share-sheet title and copied-text context. */
  title: string;
}) {
  const t = useTranslations("share");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const isWeChat = useSyncExternalStore(subscribeNoop, readIsWeChat, () => false);

  // Popover dismiss: outside pointer-down or Escape.
  // Also moves focus into the popover on open and returns it to the trigger on close.
  useEffect(() => {
    if (!popoverOpen) return;
    // Move focus to the primary action inside the dialog for SR/keyboard users.
    const popoverEl = popoverRef.current;
    const focusTarget = popoverEl?.querySelector<HTMLButtonElement>("button");
    focusTarget?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const triggerNode = triggerRef.current;
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      // Return focus to the trigger when the dialog closes via Escape/outside-click.
      triggerNode?.focus();
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

  const handleShare = async () => {
    if (isWeChat) {
      setPopoverOpen(true);
      return;
    }
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(buildShareData(url, title));
        return;
      } catch (err) {
        // AbortError = the user dismissed the native sheet — not a failure.
        if ((err as DOMException)?.name !== "AbortError") await copyLink();
        return;
      }
    }
    await copyLink();
  };

  return (
    <span ref={rootRef} className="relative inline-flex">
      <Button
        ref={triggerRef as unknown as React.Ref<HTMLButtonElement>}
        variant="ghost"
        isIconOnly
        aria-label={t("aria")}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        className="h-9 w-9 min-w-9 text-muted hover:text-foreground"
        onPress={handleShare}
      >
        <ShareIcon size={16} />
      </Button>
      {popoverOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t("copy_link")}
          className="absolute right-0 top-full z-10 mt-2 w-56 rounded-md border border-separator bg-surface p-3 shadow-md"
        >
          <p className="text-xs leading-relaxed text-muted">{t("wechat_hint")}</p>
          <Button
            variant="primary"
            className="mt-2 w-full rounded-sm"
            onPress={() => {
              setPopoverOpen(false);
              void copyLink();
            }}
          >
            {t("copy_link")}
          </Button>
        </div>
      )}
    </span>
  );
}
