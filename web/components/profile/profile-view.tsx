"use client";

import { useState, useTransition, useId, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { HeartIcon, CoffeeIcon } from "@/components/icons";
import { SignInButton } from "@/app/auth/sign-in-button";
import { SignOutButton } from "@/app/auth/sign-out-button";
import { LAUNCH_CITIES, type CityInfo } from "@/lib/cities";
import {
  subscribeRecentSearches,
  getRecentSearchesSnapshot,
  getRecentSearchesServerSnapshot,
  clearRecentSearches,
} from "@/lib/search/recent-searches";
import type {
  UserProfileDto,
  UserProfileStatsDto,
  UserCheckInItemDto,
  UserCafeItemDto,
} from "@/lib/db/profile";

export interface ProfileViewProps {
  initialProfile: UserProfileDto | null;
  initialStats: UserProfileStatsDto | null;
  isAuthenticated: boolean;
}

type TabType = "checkins" | "map" | "favorites" | "history";

async function fetchUserCheckIns(cursor?: string) {
  const url = new URL("/api/profile/checkins", window.location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to load check-ins");
  return (await res.json()) as { items: UserCheckInItemDto[]; next_cursor: string | null };
}

async function fetchUserCafes(cursor?: string) {
  const url = new URL("/api/profile/cafes", window.location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to load cafes");
  return (await res.json()) as { items: UserCafeItemDto[]; next_cursor: string | null };
}

export function ProfileView({
  initialProfile,
  initialStats,
  isAuthenticated,
}: ProfileViewProps) {
  const t = useTranslations("profile");
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfileDto | null>(initialProfile);
  const [stats] = useState<UserProfileStatsDto | null>(initialStats);
  const [activeTab, setActiveTab] = useState<TabType>("checkins");

  // Inline name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.displayName ?? "");
  const [isSavingName, startSavingName] = useTransition();

  // City selector state
  const [isSelectingCity, setIsSelectingCity] = useState(false);
  const [isSavingCity, startSavingCity] = useTransition();

  // Tab IDs for a11y
  const baseId = useId();

  // Client-side recent searches subscription
  const recentSearches = useSyncExternalStore(
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot,
  );

  // Check-ins query
  const checkinsQuery = useInfiniteQuery({
    queryKey: ["profile", "checkins"],
    queryFn: ({ pageParam }) => fetchUserCheckIns(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: isAuthenticated,
  });

  // Cafes query
  const cafesQuery = useInfiniteQuery({
    queryKey: ["profile", "cafes"],
    queryFn: ({ pageParam }) => fetchUserCafes(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: isAuthenticated,
  });

  const checkins = checkinsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const cafes = cafesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed.length > 24) return;
    startSavingName(async () => {
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: trimmed }),
        });
        if (res.ok) {
          const data = (await res.json()) as { profile: UserProfileDto };
          setProfile(data.profile);
          setIsEditingName(false);
        }
      } catch (err) {
        console.error("Failed to save name:", err);
      }
    });
  };

  const handleSelectCity = (cityId: string) => {
    startSavingCity(async () => {
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentCity: cityId }),
        });
        if (res.ok) {
          const data = (await res.json()) as { profile: UserProfileDto };
          setProfile(data.profile);
          setIsSelectingCity(false);
        }
      } catch (err) {
        console.error("Failed to save city:", err);
      }
    });
  };

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const currentCityName =
    LAUNCH_CITIES.find((c) => c.id.toLowerCase() === profile?.currentCity.toLowerCase())?.name ??
    profile?.currentCity ??
    "Singapore";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
      {/* Top App Bar */}
      <header className="w-full max-w-[640px] px-4 md:px-6 pt-4 pb-2 flex items-center justify-between">
        <button
          onClick={handleBack}
          aria-label={t("back")}
          className="inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-full hover:bg-surface-secondary text-foreground active:scale-95 transition-all"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.5 15L7.5 10L12.5 5" />
          </svg>
        </button>
        <span className="font-display font-semibold text-lg">{t("title")}</span>
        <ThemeToggle />
      </header>

      <main className="w-full max-w-[640px] px-4 md:px-6 py-4 flex-1 flex flex-col">
        {!isAuthenticated ? (
          /* Anonymous Gate (DG94) */
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 relative">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
              <CoffeeIcon size={240} />
            </div>
            <div className="w-20 h-20 rounded-full bg-surface-tertiary flex items-center justify-center mb-6 text-muted border border-border/40">
              <CoffeeIcon size={36} />
            </div>
            <h1 className="font-display font-bold text-2xl mb-3 text-foreground">
              {t("gate_title")}
            </h1>
            <p className="text-sm text-muted max-w-sm mb-8 leading-relaxed">
              {t("gate_body")}
            </p>
            <div className="w-full max-w-xs flex flex-col gap-3">
              <SignInButton provider="apple" variant="primary" />
              <SignInButton provider="google" variant="outline" />
            </div>
          </div>
        ) : (
          /* Authenticated Profile View */
          <>
            {/* Hero Header */}
            <div className="flex flex-col items-center text-center relative pt-2 pb-6">
              {/* Cup watermark background */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none opacity-[0.06] text-foreground">
                <CoffeeIcon size={120} />
              </div>

              {/* Avatar circle (80px) */}
              <div className="w-20 h-20 rounded-full bg-surface-tertiary border border-border flex items-center justify-center mb-4 overflow-hidden shadow-xs relative z-10">
                {profile?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-display font-bold text-2xl text-foreground">
                    {profile?.displayName?.[0]?.toUpperCase() ?? "A"}
                  </span>
                )}
              </div>

              {/* Display Name with inline pencil edit */}
              <div className="relative z-10 flex items-center justify-center gap-2 mb-2">
                {isEditingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={24}
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveName();
                        if (e.key === "Escape") {
                          setNameInput(profile?.displayName ?? "");
                          setIsEditingName(false);
                        }
                      }}
                      autoFocus
                      className="px-2 py-1 text-lg font-display font-bold bg-surface-secondary border border-primary rounded-md outline-none text-foreground text-center"
                      placeholder={t("edit_name_placeholder")}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      onPress={handleSaveName}
                      isDisabled={isSavingName || !nameInput.trim()}
                    >
                      {t("save")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        setNameInput(profile?.displayName ?? "");
                        setIsEditingName(false);
                      }}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <h1 className="font-display font-bold text-2xl text-foreground">
                      {profile?.displayName ?? "A nomad"}
                    </h1>
                    <button
                      onClick={() => {
                        setNameInput(profile?.displayName ?? "");
                        setIsEditingName(true);
                      }}
                      aria-label={t("edit_name_placeholder")}
                      className="p-1 text-muted hover:text-foreground active:scale-95 transition-all rounded-full"
                    >
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L4.5 13.5l-3 0.5 0.5-3L11.5 2.5Z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>

              {/* City Chip */}
              <div className="relative z-10 mb-4">
                {isSelectingCity ? (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md p-2 bg-surface border border-border rounded-xl shadow-md">
                    {LAUNCH_CITIES.map((c: CityInfo) => (
                      <button
                        key={c.id}
                        disabled={isSavingCity}
                        onClick={() => handleSelectCity(c.id)}
                        className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                          c.id.toLowerCase() === profile?.currentCity.toLowerCase()
                            ? "bg-primary text-primary-foreground font-medium"
                            : "bg-surface-secondary text-muted hover:text-foreground"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                    <button
                      onClick={() => setIsSelectingCity(false)}
                      className="px-2 py-1 text-xs text-muted hover:text-foreground"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsSelectingCity(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-secondary border border-border/50 text-xs text-muted hover:text-foreground active:scale-95 transition-all"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5A4.5 4.5 0 0 0 8 1.5Z" />
                      <circle cx="8" cy="6" r="1.5" />
                    </svg>
                    <span>{currentCityName}</span>
                  </button>
                )}
              </div>

              {/* Sign out */}
              <div className="w-full max-w-[140px] mt-1">
                <SignOutButton />
              </div>
            </div>

            {/* Stats Row */}
            <div className="w-full bg-surface border border-border rounded-xl p-4 my-4 flex items-center justify-around">
              <div className="flex flex-col items-center">
                <span className="font-mono font-bold text-2xl text-foreground tabular-nums">
                  {stats?.cafesCount ?? 0}
                </span>
                <span className="text-xs text-muted font-medium mt-0.5">{t("stats_cafes")}</span>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="flex flex-col items-center">
                <span className="font-mono font-bold text-2xl text-foreground tabular-nums">
                  {stats?.checkinsCount ?? 0}
                </span>
                <span className="text-xs text-muted font-medium mt-0.5">{t("stats_checkins")}</span>
              </div>
            </div>

            {/* Segmented Control Tabs */}
            <div
              role="tablist"
              className="flex items-center gap-1 p-1 bg-surface-secondary rounded-xl my-4 overflow-x-auto no-scrollbar"
            >
              <button
                role="tab"
                id={`${baseId}-tab-checkins`}
                aria-selected={activeTab === "checkins"}
                aria-controls={`${baseId}-panel-checkins`}
                onClick={() => setActiveTab("checkins")}
                className={`flex-1 min-w-[90px] py-2 px-3 text-xs font-medium rounded-lg transition-all text-center whitespace-nowrap ${
                  activeTab === "checkins"
                    ? "bg-surface text-foreground shadow-xs font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t("tab_checkins")}
              </button>
              <button
                role="tab"
                id={`${baseId}-tab-map`}
                aria-selected={activeTab === "map"}
                aria-controls={`${baseId}-panel-map`}
                onClick={() => setActiveTab("map")}
                className={`flex-1 min-w-[90px] py-2 px-3 text-xs font-medium rounded-lg transition-all text-center whitespace-nowrap ${
                  activeTab === "map"
                    ? "bg-surface text-foreground shadow-xs font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t("tab_map")}
              </button>
              <button
                role="tab"
                id={`${baseId}-tab-favorites`}
                aria-selected={activeTab === "favorites"}
                aria-controls={`${baseId}-panel-favorites`}
                onClick={() => setActiveTab("favorites")}
                className={`flex-1 min-w-[90px] py-2 px-3 text-xs font-medium rounded-lg transition-all text-center whitespace-nowrap ${
                  activeTab === "favorites"
                    ? "bg-surface text-foreground shadow-xs font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t("tab_favorites")}
              </button>
              <button
                role="tab"
                id={`${baseId}-tab-history`}
                aria-selected={activeTab === "history"}
                aria-controls={`${baseId}-panel-history`}
                onClick={() => setActiveTab("history")}
                className={`flex-1 min-w-[90px] py-2 px-3 text-xs font-medium rounded-lg transition-all text-center whitespace-nowrap ${
                  activeTab === "history"
                    ? "bg-surface text-foreground shadow-xs font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t("tab_history")}
              </button>
            </div>

            {/* Tab Panels */}
            <div className="flex-1 flex flex-col py-2">
              {/* Tab 1: My Check-ins */}
              {activeTab === "checkins" && (
                <div
                  role="tabpanel"
                  id={`${baseId}-panel-checkins`}
                  aria-labelledby={`${baseId}-tab-checkins`}
                  className="flex flex-col gap-3"
                >
                  {checkinsQuery.isError && (
                    <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between text-sm text-muted">
                      <span>{t("load_error")}</span>
                      <Button size="sm" variant="outline" onPress={() => void checkinsQuery.refetch()}>
                        {t("retry")}
                      </Button>
                    </div>
                  )}

                  {!checkinsQuery.isError && checkins.length === 0 && !checkinsQuery.isLoading && (
                    <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
                      <p className="text-sm text-muted">{t("empty_checkins")}</p>
                      <Link
                        href="/"
                        className="text-sm text-primary font-medium hover:underline"
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
                                {item.cafeName}
                              </span>
                            ) : (
                              <Link
                                href={`/?cafe=${item.cafeId}`}
                                className="font-display font-semibold text-foreground text-base hover:text-primary transition-colors"
                              >
                                {item.cafeName}
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
                              aria-label={t("edit_checkin_aria", { cafe: item.cafeName })}
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
              )}

              {/* Tab 2: 我的咖啡地图 (My Coffee Map) */}
              {activeTab === "map" && (
                <div
                  role="tabpanel"
                  id={`${baseId}-panel-map`}
                  aria-labelledby={`${baseId}-tab-map`}
                  className="flex flex-col gap-3"
                >
                  {cafesQuery.isError && (
                    <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between text-sm text-muted">
                      <span>{t("load_error")}</span>
                      <Button size="sm" variant="outline" onPress={() => void cafesQuery.refetch()}>
                        {t("retry")}
                      </Button>
                    </div>
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
                            {cafe.name}
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
              )}

              {/* Tab 3: Favorites (Design-ahead) */}
              {activeTab === "favorites" && (
                <div
                  role="tabpanel"
                  id={`${baseId}-panel-favorites`}
                  aria-labelledby={`${baseId}-tab-favorites`}
                  className="py-16 flex flex-col items-center justify-center text-center px-4"
                >
                  <div className="w-12 h-12 rounded-full bg-surface-secondary flex items-center justify-center mb-3 text-muted">
                    <HeartIcon size={20} />
                  </div>
                  <h2 className="font-display font-semibold text-lg text-foreground mb-1">
                    {t("empty_favorites_title")}
                  </h2>
                  <p className="text-sm text-muted max-w-xs leading-relaxed">
                    {t("empty_favorites_body")}
                  </p>
                </div>
              )}

              {/* Tab 4: Search History (Design-ahead) */}
              {activeTab === "history" && (
                <div
                  role="tabpanel"
                  id={`${baseId}-panel-history`}
                  aria-labelledby={`${baseId}-tab-history`}
                  className="flex flex-col gap-2"
                >
                  {recentSearches.length === 0 ? (
                    <div className="py-16 flex flex-col items-center justify-center text-center">
                      <p className="text-sm text-muted">{t("empty_history_title")}</p>
                    </div>
                  ) : (
                    <>
                      {recentSearches.map((item) => (
                        <Link
                          key={item.id}
                          href={`/?q=${encodeURIComponent(item.query)}&city=${encodeURIComponent(item.city)}`}
                          className="p-3 bg-surface border border-border rounded-xl flex items-center justify-between hover:border-border/80 active:scale-[0.99] transition-all"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted flex-shrink-0">
                              <circle cx="7" cy="7" r="4.5" />
                              <path d="M10.5 10.5L14 14" />
                            </svg>
                            <span className="text-sm font-medium text-foreground truncate">
                              {item.query}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-surface-secondary text-[11px] text-muted">
                              {item.city}
                            </span>
                          </div>
                          <span className="text-xs text-muted font-mono tabular-nums flex-shrink-0">
                            {new Date(item.timestamp).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </Link>
                      ))}
                      <div className="flex justify-center pt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={clearRecentSearches}
                        >
                          {t("clear_history")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
