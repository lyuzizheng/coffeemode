"use client";

/**
 * First-visit welcome card (onboarding-v1 §2–§3, DG114–DG118): bottom-anchored,
 * non-modal — the surface behind it stays visible and interactive, no scrim.
 * One card, two choices: enable location, or pick a city / skip.
 *
 * Denied state (DG117): no red error styling — the detection line swaps to
 * "Location is off — pick your city", the city Select takes focus, and the
 * primary button becomes "Use {city}".
 */
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, ListBox, Select } from "@heroui/react";
import { useLocale, useTranslations } from "next-intl";
import { duration, ease } from "@/lib/motion";
import { displayCityName, LAUNCH_CITIES, type CityInfo } from "@/lib/cities";
import { CoffeeIcon } from "@/components/icons";

function CityPickerRow({
  selectedCityId,
  denied,
  onPickCity,
  onSkip,
}: {
  selectedCityId: string;
  /** Denied recovery focuses the picker (artifact §3) — the only place this
   * card moves focus; mount never does (non-modal, map first). */
  denied: boolean;
  onPickCity: (cityId: string) => void;
  onSkip: () => void;
}) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const selectTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (denied) selectTriggerRef.current?.focus();
  }, [denied]);

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label={t("pick_city")}
        selectedKey={selectedCityId}
        onSelectionChange={(key) => {
          if (key != null) onPickCity(String(key));
        }}
      >
        <Select.Trigger
          ref={selectTriggerRef}
          className="h-9 rounded-full border border-separator bg-surface px-3 text-sm text-foreground"
        >
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {LAUNCH_CITIES.map((city) => (
              <ListBox.Item
                key={city.id}
                id={city.id}
                textValue={displayCityName(city.id, locale)}
              >
                {displayCityName(city.id, locale)}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <Button variant="ghost" onPress={onSkip}>
        {t("skip")}
      </Button>
    </div>
  );
}
function PrimaryAction({
  denied,
  locating,
  selectedCityName,
  onEnableLocation,
  onUseCity,
}: {
  denied: boolean;
  locating: boolean;
  selectedCityName: string;
  onEnableLocation: () => void;
  onUseCity: () => void;
}) {
  const t = useTranslations("onboarding");
  if (denied) {
    return (
      <Button variant="primary" fullWidth className="h-12" onPress={onUseCity}>
        {t("use_city", { city: selectedCityName })}
      </Button>
    );
  }
  return (
    <Button
      variant="primary"
      fullWidth
      className="h-12"
      isDisabled={locating}
      onPress={onEnableLocation}
    >
      <span className={locating ? "opacity-60" : undefined}>
        {locating ? t("locating") : t("enable_location")}
      </span>
    </Button>
  );
}


export function WelcomeCard({
  detectedCity,
  denied,
  locating,
  selectedCityId,
  onEnableLocation,
  onSkip,
  onPickCity,
  onUseCity,
}: {
  /** IP-detected launch city; null → no detection line, Skip → Singapore. */
  detectedCity: CityInfo | null;
  /** Permission denied/unavailable: picker-focused recovery state. */
  denied: boolean;
  /** Geolocation request in flight — primary shows "Locating…" at 60%. */
  locating: boolean;
  selectedCityId: string;
  onEnableLocation: () => void;
  onSkip: () => void;
  onPickCity: (cityId: string) => void;
  onUseCity: () => void;
}) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const reduced = useReducedMotion();

  const selectedCityName = displayCityName(selectedCityId, locale);
  const detectedName = detectedCity ? displayCityName(detectedCity.id, locale) : null;
  const statusLine = denied
    ? t("location_off")
    : detectedName
      ? t("detected", { city: detectedName })
      : null;

  return (
    <motion.div
      role="dialog"
      aria-modal={false}
      aria-label={t("dialog_aria")}
      initial={reduced ? false : { y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduced ? undefined : { y: 24, opacity: 0 }}
      transition={
        reduced ? { duration: 0 } : { duration: duration.state, ease: ease.default }
      }
      className="fixed inset-x-4 bottom-[calc(172px+16px+env(safe-area-inset-bottom))] z-40 mx-auto w-auto max-w-[420px] rounded-lg border border-separator bg-overlay p-4 shadow-lg lg:bottom-6 lg:left-[calc(50%+190px)] lg:right-auto lg:mx-0 lg:w-[calc(100%-2rem)] lg:-translate-x-1/2"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <CoffeeIcon size={24} className="text-accent" />
          <span className="font-display text-lg font-bold text-foreground">
            CafeMood
          </span>
        </div>

        <p className="font-display text-md font-bold text-foreground">
          {t("headline")}
        </p>

        {statusLine ? <p className="text-sm text-muted">{statusLine}</p> : null}

        <PrimaryAction
          denied={denied}
          locating={locating}
          selectedCityName={selectedCityName}
          onEnableLocation={onEnableLocation}
          onUseCity={onUseCity}
        />

        <CityPickerRow
          selectedCityId={selectedCityId}
          denied={denied}
          onPickCity={onPickCity}
          onSkip={onSkip}
        />
      </div>
    </motion.div>
  );
}
