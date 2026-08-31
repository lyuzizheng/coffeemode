"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@heroui/react";
import { CoffeeIcon } from "@/components/icons";
import { LAUNCH_CITIES, type CityInfo } from "@/lib/cities";
import type { UserProfileDto } from "@/lib/db/profile";

interface ProfileHeroProps {
  profile: UserProfileDto | null;
  onProfileChange: (updated: UserProfileDto) => void;
}

export function ProfileHero({ profile, onProfileChange }: ProfileHeroProps) {
  const t = useTranslations("profile");
  const locale = useLocale();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.displayName ?? "");
  const [isSavingName, startSavingName] = useTransition();

  const [isSelectingCity, setIsSelectingCity] = useState(false);
  const [isSavingCity, startSavingCity] = useTransition();

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
          onProfileChange(data.profile);
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
          onProfileChange(data.profile);
          setIsSelectingCity(false);
        }
      } catch (err) {
        console.error("Failed to save city:", err);
      }
    });
  };

  const currentCityObj = LAUNCH_CITIES.find(
    (c) => c.id.toLowerCase() === (profile?.currentCity ?? "singapore").toLowerCase(),
  );
  const currentCityName =
    (locale === "zh" ? currentCityObj?.nameZh : currentCityObj?.name) ??
    profile?.currentCity ??
    t("default_city");

  const avatarFallback =
    profile?.displayName?.[0]?.toUpperCase() ?? t("default_avatar");

  return (
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
            {avatarFallback}
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
              className="px-2 py-1 text-lg font-display font-bold bg-surface-secondary border border-accent rounded-md outline-none text-foreground text-center"
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
              {profile?.displayName ?? t("default_name")}
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

      {/* City Chip & DG97 Inline City Selector */}
      <div className="relative z-10 mb-2">
        {isSelectingCity ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md p-2 bg-surface border border-border rounded-xl shadow-md">
            {LAUNCH_CITIES.map((c: CityInfo) => {
              const localizedCityName = locale === "zh" ? c.nameZh : c.name;
              const isSelected = c.id.toLowerCase() === profile?.currentCity.toLowerCase();
              return (
                <button
                  key={c.id}
                  disabled={isSavingCity}
                  onClick={() => handleSelectCity(c.id)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground font-medium"
                      : "bg-surface-secondary text-muted hover:text-foreground"
                  }`}
                >
                  {localizedCityName}
                </button>
              );
            })}
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
    </div>
  );
}
