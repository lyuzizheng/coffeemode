"use client";

import Link from "next/link";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import type { UseInfiniteQueryResult, InfiniteData } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { CoffeeIcon } from "@/components/icons";
import { PrivateBadge } from "@/components/cafe/private-badge";
import { THUMB_PX } from "@/lib/layout";
import { apiFetch, isUnauthorized } from "@/lib/http";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { ErrorRow } from "./profile-error-row";
import type { UserCafeItemDto } from "@/lib/db/profile";

export async function fetchUserCafes(cursor?: string) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return apiFetch<{ items: UserCafeItemDto[]; next_cursor: string | null }>(
    `/api/profile/cafes${qs ? `?${qs}` : ""}`,
  );
}

interface ProfileTabCafesProps {
  baseId: string;
  query: UseInfiniteQueryResult<InfiniteData<{ items: UserCafeItemDto[]; next_cursor: string | null }>, Error>;
  /** Restarts pagination from page one — never replays a dead cursor (BRAWUKA-442). */
  onRetry: () => void;
}

export function ProfileTabCafes({ baseId, query: cafesQuery, onRetry }: ProfileTabCafesProps) {
  const t = useTranslations("profile");
  const locale = useLocale();

  const cafes = cafesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-map`}
      aria-labelledby={`${baseId}-tab-map`}
      className="flex flex-col gap-3"
    >
      {cafesQuery.isError &&
        (isUnauthorized(cafesQuery.error) ? (
          // Session died under a mounted tab — the gate, not a retry that
          // can only 401 again (BRAWUKA-540).
          <SignInGate message={t("gate_body")} next="/profile" />
        ) : (
          <ErrorRow
            errorText={t("load_error")}
            retryText={t("retry")}
            onRetry={onRetry}
          />
        ))}

      {!cafesQuery.isError && cafes.length === 0 && !cafesQuery.isLoading && (
        <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-sm text-muted">{t("emptyCafes")}</p>
        </div>
      )}

      {cafes.map((cafe) => (
        <Link
          key={cafe.id}
          href={`/cafes/${cafe.id}`}
          className="p-3 bg-surface border border-separator rounded-md flex items-center gap-3 hover:border-border/80 active:scale-[0.99] transition-all"
        >
          <div className="relative w-[var(--layout-thumb)] h-[calc(var(--layout-thumb)*3/4)] rounded-sm bg-surface-secondary border border-separator flex-shrink-0 flex items-center justify-center overflow-hidden">
            {cafe.cover ? (
              <Image
                src={cafe.cover}
                alt={cafe.name}
                fill
                sizes={`${THUMB_PX}px`}
                className="object-cover"
              />
            ) : (
              <div className="text-muted/60">
                <CoffeeIcon size={22} />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-display font-bold text-foreground text-md truncate">
                {cafe.name || t("unknown_cafe")}
              </span>
              {cafe.is_creation && (
                <span className="text-muted font-normal text-xs inline-flex items-center gap-0.5">
                  <span>+</span>
                  <span>{t("created_by_me")}</span>
                </span>
              )}
              {/* DG147: private rows only ever reach the owner (read-path
                  filter) — composes with "created by me" when both apply. */}
              {cafe.visibility === "private" && <PrivateBadge />}
            </div>

            <span className="text-xs text-muted font-mono tabular-nums mt-1">
              {t("last_visit", {
                date: new Intl.DateTimeFormat(locale, {
                  day: "numeric",
                  month: "short",
                }).format(new Date(cafe.last_visited_at)),
              })}{" "}
              · {t("checkins_count", { count: cafe.checkins_count })}
            </span>
          </div>
        </Link>
      ))}

      {cafesQuery.hasNextPage && (
        <Button
          variant="outline"
          className="w-full mt-2"
          isDisabled={cafesQuery.isFetchingNextPage}
          onPress={() => void cafesQuery.fetchNextPage()}
        >
          {t("load_more")}
        </Button>
      )}
    </div>
  );
}
