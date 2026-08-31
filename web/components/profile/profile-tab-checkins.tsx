"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UseInfiniteQueryResult, InfiniteData } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { HeartIcon } from "@/components/icons";
import { CheckinDrawer } from "@/components/checkin/checkin-drawer";
import { ErrorRow } from "./profile-error-row";
import type { UserCheckInItemDto } from "@/lib/db/profile";

export async function fetchUserCheckIns(cursor?: string) {
  const url = new URL("/api/profile/checkins", window.location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to load check-ins");
  return (await res.json()) as { items: UserCheckInItemDto[]; next_cursor: string | null };
}

interface ProfileTabCheckinsProps {
  baseId: string;
  query: UseInfiniteQueryResult<InfiniteData<{ items: UserCheckInItemDto[]; next_cursor: string | null }>, Error>;
  /** The profile page only renders this tab for signed-in users. */
  isAuthenticated: boolean;
}

export function ProfileTabCheckins({ baseId, query: checkinsQuery, isAuthenticated }: ProfileTabCheckinsProps) {
  const t = useTranslations("profile");
  const [editing, setEditing] = useState<UserCheckInItemDto | null>(null);

  const checkins = checkinsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-checkins`}
      aria-labelledby={`${baseId}-tab-checkins`}
      className="flex flex-col gap-3"
    >
      {checkinsQuery.isError && (
        <ErrorRow
          errorText={t("load_error")}
          retryText={t("retry")}
          onRetry={() => void checkinsQuery.refetch()}
        />
      )}

      {!checkinsQuery.isError && checkins.length === 0 && !checkinsQuery.isLoading && (
        <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-sm text-muted">{t("empty_checkins")}</p>
          <Link
            href="/"
            className="text-sm text-accent font-medium hover:underline"
          >
            {t("empty_checkins_action")}
          </Link>
        </div>
      )}

      {checkins.map((item) => {
        const scoreEntries = Object.entries(item.scores);
        return (
          <div
            key={item.id}
            className={`p-3 bg-surface border border-border rounded-xl flex flex-col gap-2 transition-all ${
              item.cafeIsDeleted ? "opacity-60" : "hover:border-border/80"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                {item.cafeIsDeleted ? (
                  <span className="font-display font-semibold text-muted text-base">
                    {item.cafeName || t("unknown_cafe")}
                  </span>
                ) : (
                  <Link
                    href={`/?cafe=${item.cafeId}`}
                    className="font-display font-semibold text-foreground text-base hover:text-accent transition-colors"
                  >
                    {item.cafeName || t("unknown_cafe")}
                  </Link>
                )}
                <span className="text-xs text-muted font-mono tabular-nums">
                  {t("last_visit", {
                    date: new Date(item.visitedAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                  })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {item.likesCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted font-mono tabular-nums">
                    <HeartIcon size={13} filled={false} />
                    {item.likesCount}
                  </span>
                )}
                <button
                  onClick={() => setEditing(item)}
                  aria-label={t("edit_checkin_aria", { cafe: item.cafeName || t("unknown_cafe") })}
                  className="p-1.5 text-muted hover:text-foreground active:scale-95 transition-all rounded-full hover:bg-surface-secondary"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L4.5 13.5l-3 0.5 0.5-3L11.5 2.5Z" />
                  </svg>
                </button>
              </div>
            </div>

            {scoreEntries.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted font-mono">
                {scoreEntries.map(([k, score]) => (
                  <span
                    key={k}
                    className="px-2 py-0.5 rounded-md bg-surface-secondary border border-border/40 tabular-nums"
                  >
                    {k} {Math.round(score)}
                  </span>
                ))}
              </div>
            )}

            {item.notes && (
              <p className="text-xs text-foreground/80 line-clamp-2 mt-0.5">
                {item.notes}
              </p>
            )}
          </div>
        );
      })}

      {editing && (
        <CheckinDrawer
          isOpen
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          cafeId={editing.cafeId}
          cafeName={editing.cafeName || t("unknown_cafe")}
          mode="edit"
          editCheckinId={editing.id}
          initialScores={editing.scores}
          initialMaxStay={editing.maxStay}
          initialNote={editing.notes}
          isAuthenticated={isAuthenticated}
        />
      )}

      {checkinsQuery.hasNextPage && (
        <Button
          variant="outline"
          className="w-full mt-2"
          isDisabled={checkinsQuery.isFetchingNextPage}
          onPress={() => void checkinsQuery.fetchNextPage()}
        >
          {t("load_more")}
        </Button>
      )}
    </div>
  );
}
