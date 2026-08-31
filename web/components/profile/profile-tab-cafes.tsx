"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { UseInfiniteQueryResult, InfiniteData } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { CoffeeIcon } from "@/components/icons";
import { ErrorRow } from "./profile-error-row";
import type { UserCafeItemDto } from "@/lib/db/profile";

export async function fetchUserCafes(cursor?: string) {
  const url = new URL("/api/profile/cafes", window.location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to load cafes");
  return (await res.json()) as { items: UserCafeItemDto[]; next_cursor: string | null };
}

interface ProfileTabCafesProps {
  baseId: string;
  query: UseInfiniteQueryResult<InfiniteData<{ items: UserCafeItemDto[]; next_cursor: string | null }>, Error>;
}

export function ProfileTabCafes({ baseId, query: cafesQuery }: ProfileTabCafesProps) {
  const t = useTranslations("profile");

  const cafes = cafesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-map`}
      aria-labelledby={`${baseId}-tab-map`}
      className="flex flex-col gap-3"
    >
      {cafesQuery.isError && (
        <ErrorRow
          errorText={t("load_error")}
          retryText={t("retry")}
          onRetry={() => void cafesQuery.refetch()}
        />
      )}

      {!cafesQuery.isError && cafes.length === 0 && !cafesQuery.isLoading && (
        <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-sm text-muted">{t("emptyCafes")}</p>
        </div>
      )}

      {cafes.map((cafe) => (
        <Link
          key={cafe.id}
          href={`/?cafe=${cafe.id}`}
          className="p-3 bg-surface border border-border rounded-xl flex items-center gap-3 hover:border-border/80 active:scale-[0.99] transition-all"
        >
          <div className="w-[72px] h-[54px] rounded-lg bg-surface-secondary border border-border/40 flex-shrink-0 flex items-center justify-center overflow-hidden">
            {cafe.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cafe.cover}
                alt={cafe.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-muted/60">
                <CoffeeIcon size={22} />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-display font-semibold text-foreground text-base truncate">
                {cafe.name || t("unknown_cafe")}
              </span>
              {cafe.isCreation && (
                <span className="text-secondary font-normal text-xs inline-flex items-center gap-0.5">
                  <span>+</span>
                  <span>{t("created_by_me")}</span>
                </span>
              )}
            </div>

            <span className="text-xs text-muted font-mono tabular-nums mt-1">
              {t("last_visit", {
                date: new Date(cafe.lastVisitedAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                }),
              })}{" "}
              · {t("checkins_count", { count: cafe.checkinsCount })}
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
