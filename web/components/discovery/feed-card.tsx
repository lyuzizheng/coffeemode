/**
 * Feed card (artifact §5.3.5 + §6, spec 0001, DG72/DG113).
 *
 * One check-in: author line, dimension mini-scores, serif note, photos,
 * like toggle, and — on the viewer's own cards only — the overflow menu
 * opening the check-in drawer prefilled in edit mode (DG72; the profile
 * history list is the other entry — owner verdict BRAWUKA-120).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { DotsIcon, HeartIcon, PencilIcon } from "@/components/icons";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import { CheckinNote } from "@/components/checkin/checkin-note";
import { WORK_DIMS, type WorkDim } from "@/lib/stats/work-stats";
import type { PublicCheckIn } from "@/types/checkins";
import type { PublicAuthor } from "@/types/identity";

/** `A nomad · Mar 2026`, or the consented author name/avatar (spec 0006). */
function FeedCardMeta({ visitedAt, author }: { visitedAt: string; author: PublicAuthor | null }) {
  const t = useTranslations("discovery");
  const locale = useLocale();
  const date = new Date(visitedAt);
  const label = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(date);
  return (
    <p className="flex items-center gap-1.5 text-sm text-foreground">
      {author?.avatar_url && (
        <Image
          src={author.avatar_url}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 rounded-full object-cover"
        />
      )}
      <span>
        {author ? t("by_author", { name: author.display_name }) : t("a_nomad")}
        {label && <span className="text-muted"> · {label}</span>}
      </span>
    </p>
  );
}

/** Dimension mini-scores as text chips: `wifi 87 · coffee 81` (text-xs muted tabular). */
function MiniScores({ checkin }: { checkin: PublicCheckIn }) {
  const t = useTranslations("discovery");
  const chips = WORK_DIMS.filter((dim: WorkDim) => typeof checkin.scores[dim] === "number");
  if (chips.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
      {chips.map((dim) => (
        <span key={dim} className="tnum whitespace-nowrap">
          {t(`dims.${dim}`)} {Math.round(checkin.scores[dim] ?? 0)}
        </span>
      ))}
    </p>
  );
}

// DG72 edit entry: the overflow menu renders only on the viewer's own
// cards (`owned_by_viewer` is a server-computed boolean — no user_id ever
// reaches the client, DG13). It opens the same drawer in edit mode,
// prefilled from the feed DTO (the profile history list is the other
// entry — owner verdict BRAWUKA-120).
function OwnCardMenu({ onEdit }: { onEdit: () => void }) {
  const t = useTranslations("discovery");
  const tCheckin = useTranslations("checkIn");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Menu dismiss: outside pointer-down or Escape; focus returns to trigger.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("card_actions_aria")}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-muted transition-colors hover:text-foreground"
      >
        <DotsIcon size={16} />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 z-10 min-w-44 rounded-md border border-separator bg-overlay py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
            className="flex min-h-11 w-full items-center gap-2 px-3 text-sm text-foreground transition-colors hover:bg-surface-secondary"
          >
            <PencilIcon size={14} />
            {tCheckin("editYourCheckIn")}
          </button>
        </div>
      )}
    </div>
  );
}

function OwnCardEditEntry({
  cafeId,
  cafeName,
  checkin,
}: {
  cafeId: string;
  cafeName: string;
  checkin: PublicCheckIn;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <OwnCardMenu onEdit={() => setEditing(true)} />
      {/* Same drawer as the profile history edit entry: prefilled from the
          feed DTO. Save/delete invalidation lives in the drawer itself. */}
      {editing && (
        <CheckinDrawer
          isOpen
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditing(false);
          }}
          cafeId={cafeId}
          cafeName={cafeName}
          mode="edit"
          editCheckinId={checkin.id}
          initialScores={checkin.scores}
          initialMaxStay={checkin.max_stay}
          initialNote={checkin.note}
        />
      )}
    </>
  );
}

export function FeedCard({
  checkin,
  cafeId,
  cafeName,
  onLike,
  likePending,
}: {
  checkin: PublicCheckIn;
  cafeId: string;
  cafeName: string;
  onLike: (checkin: PublicCheckIn) => void;
  likePending: boolean;
}) {
  const t = useTranslations("discovery");
  const liked = checkin.liked_by_viewer;

  return (
    <article className="flex flex-col gap-2 rounded-md border border-separator bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <FeedCardMeta visitedAt={checkin.visited_at} author={checkin.author} />
        {checkin.owned_by_viewer && (
          <OwnCardEditEntry cafeId={cafeId} cafeName={cafeName} checkin={checkin} />
        )}
      </div>
      <MiniScores checkin={checkin} />
      <CheckinNote note={checkin.note ?? ""} />
      {checkin.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {checkin.photos.map((photo) => (
            <span
              key={photo.id}
              className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-separator bg-surface-tertiary"
            >
              <Image
                src={photo.thumbnail}
                alt=""
                fill
                sizes="72px"
                className="object-cover"
              />
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={liked}
          aria-label={t("like_aria")}
          disabled={likePending}
          onClick={() => onLike(checkin)}
          className={`flex min-h-11 min-w-11 -translate-x-2.5 items-center gap-1 rounded-sm px-2.5 text-xs ${
            liked ? "text-danger" : "text-muted"
          } transition-colors hover:text-foreground`}
        >
          <HeartIcon size={14} filled={liked} />
          <span className="tnum">{checkin.likes_count}</span>
        </button>
      </div>
    </article>
  );
}
