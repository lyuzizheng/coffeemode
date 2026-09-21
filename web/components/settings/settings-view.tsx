"use client";

/**
 * /settings — grouped preferences + account + legal surface (BRAWUKA-504).
 * Mobile-first single column; every change applies instantly, no save
 * button. Anonymous visitors get the Preferences + Legal groups and a
 * sign-in gate row in place of the Account group (DG136 spirit: local
 * settings never require an account).
 *
 * Preferences migrated out of /profile (owner directive 2026-09-19
 * supersedes profile-page-v2 §4): theme, language, design variant, search
 * ranking, and public identity all live here now.
 */
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMounted } from "@/hooks/use-mounted";
import { useThemeVariant, VARIANTS, type ThemeVariant } from "@/lib/theme-variant";
import { RankingPreferenceToggle } from "@/components/search/ranking-preference-toggle";
import { PublicIdentityToggle } from "@/components/profile/public-identity-toggle";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { DangerConfirm } from "@/components/danger-confirm";
import { AppMenu } from "@/components/layout/app-menu";
import { SettingsGroup, SettingsRow } from "./settings-row";
import { apiFetch, isUnauthorized } from "@/lib/http";
import { idbPersister } from "@/lib/query/persister";
import type { UserProfileDto } from "@/lib/db/profile";

const THEME_OPTIONS = ["light", "dark", "system"] as const;

/** Three-option segmented control — the settings-screen picker shape
 * (mirrors ThemeVariantPicker's track/thumb so both pickers read as one
 * control family). */
function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  renderOption,
}: {
  ariaLabel: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  renderOption: (option: T) => string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex w-fit gap-0.5 rounded-md bg-surface-secondary p-0.5"
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className="group cm-focus -my-1.5 flex min-h-11 items-center"
          >
            <span
              className={`rounded-sm px-3 py-1.5 text-sm transition-colors duration-120 ${
                selected
                  ? "border border-separator bg-surface font-medium text-foreground"
                  : "border border-transparent text-muted group-hover:text-foreground"
              }`}
            >
              {renderOption(option)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ThemePreference() {
  const t = useTranslations("settings");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const active = mounted && (theme === "light" || theme === "dark") ? theme : "system";
  return (
    <SegmentedControl
      ariaLabel={t("theme")}
      options={THEME_OPTIONS}
      value={active}
      onChange={setTheme}
      renderOption={(o) => t(`theme_${o}`)}
    />
  );
}

function LanguagePreference() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const switchTo = (next: string) => {
    if (next === locale) return;
    document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`;
    router.refresh();
  };
  return (
    <SegmentedControl
      ariaLabel={t("language")}
      options={["zh", "en"] as const}
      value={locale === "zh" ? "zh" : "en"}
      onChange={switchTo}
      renderOption={(o) => (o === "zh" ? "中文" : "English")}
    />
  );
}

function VariantPreference() {
  const t = useTranslations("settings");
  const tv = useTranslations("profile.variant");
  const { variant, setVariant } = useThemeVariant();
  const mounted = useMounted();
  if (!mounted) {
    return <div className="h-12 rounded-md bg-surface-secondary" aria-hidden />;
  }
  return (
    <SegmentedControl
      ariaLabel={t("theme_variant")}
      options={VARIANTS}
      value={variant}
      onChange={(v: ThemeVariant) => setVariant(v)}
      renderOption={(o) => tv(o)}
    />
  );
}

/** Download-my-data: a plain link to the export route — the response's
 * Content-Disposition does the download, no client fetch needed. */
function ExportRow() {
  const t = useTranslations("settings");
  return (
    <SettingsRow
      label={t("export")}
      description={t("export_desc")}
      href="/api/profile/export"
    />
  );
}

/** The expanded type-to-confirm form for account deletion. */
function DeleteConfirmForm({
  confirmText,
  pending,
  armed,
  error,
  onTextChange,
  onCancel,
  onConfirm,
}: {
  confirmText: string;
  pending: boolean;
  armed: boolean;
  error: boolean;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("settings");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-foreground">
        {t("delete_confirm_body")}
      </p>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        {t("delete_confirm_label")}
        <input
          type="text"
          value={confirmText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          className="cm-focus w-40 rounded-sm border border-border bg-surface px-2.5 py-2 font-mono text-sm text-foreground"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {t("delete_error")}
        </p>
      ) : null}
      <DangerConfirm
        message={t("delete_confirm_title")}
        confirmLabel={pending ? t("delete_pending") : t("delete_confirm_label")}
        cancelLabel={t("cancel")}
        pending={pending || !armed}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </div>
  );
}

/** Permanent account deletion: type-to-confirm inside the danger zone.
 * The API does the data teardown; the client then signs out locally. */
function DeleteAccountSection() {
  const t = useTranslations("settings");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  const run = async () => {
    setPending(true);
    setError(false);
    try {
      await apiFetch("/api/profile", { method: "DELETE" });
      // The account is gone — its profile/cafe data must not survive in the
      // browser store. Same teardown as SignOutButton: drop the IndexedDB
      // persistor first, then the live TanStack client (BRAWUKA-540).
      try {
        await idbPersister.removeClient();
      } catch (e) {
        console.error("settings-view: failed to clear persisted cache", e);
      }
      queryClient.clear();
      router.push("/");
      router.refresh();
    } catch (cause) {
      if (isUnauthorized(cause)) {
        setSessionExpired(true);
        return;
      }
      setError(true);
    } finally {
      setPending(false);
    }
  };

  if (sessionExpired) {
    return (
      <div className="px-4 py-3">
        <SignInGate message={t("sign_in_gate")} next="/settings" />
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="cm-focus flex min-h-11 w-full items-center text-left text-sm font-medium text-danger"
        >
          {t("delete")}
        </button>
      ) : (
        <DeleteConfirmForm
          confirmText={confirmText}
          pending={pending}
          armed={armed}
          error={error}
          onTextChange={setConfirmText}
          onCancel={() => {
            setExpanded(false);
            setConfirmText("");
            setError(false);
          }}
          onConfirm={() => void run()}
        />
      )}
    </div>
  );
}

/** Account group: profile link, sign-out, data export, permanent deletion —
 * or the sign-in gate for anonymous visitors. */
function AccountSection({
  isAuthenticated,
  t,
}: {
  isAuthenticated: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <SettingsGroup label={t("account")}>
      {isAuthenticated ? (
        <>
          <SettingsRow
            label={t("profile")}
            description={t("profile_desc")}
            href="/profile"
          />
          <SettingsRow>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-foreground">
                {t("sign_out_label")}
              </span>
              <SignOutButton variant="outline" />
            </div>
          </SettingsRow>
          <ExportRow />
          <DeleteAccountSection />
        </>
      ) : (
        <SettingsRow>
          <SignInGate message={t("sign_in_gate")} next="/settings" />
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

export function SettingsView({
  initialProfile,
  isAuthenticated,
  accountInitial,
}: {
  initialProfile: UserProfileDto | null;
  isAuthenticated: boolean;
  accountInitial?: string;
}) {
  const t = useTranslations("settings");
  const [profile, setProfile] = useState(initialProfile);

  return (
    <div className="flex min-h-screen flex-col items-center bg-background text-foreground">
      <header className="flex w-full max-w-[var(--layout-content-max)] items-center justify-between px-4 pb-2 pt-4 md:px-6">
        <span className="font-display text-lg font-semibold">{t("title")}</span>
        <AppMenu variant="page" accountInitial={accountInitial} />
      </header>

      <main className="flex w-full max-w-[var(--layout-content-max)] flex-1 flex-col gap-6 px-4 py-4 md:px-6">
        <SettingsGroup label={t("preferences")}>
          <SettingsRow
            label={t("theme")}
            description={t("theme_desc")}
            control={<ThemePreference />}
          />
          <SettingsRow
            label={t("language")}
            description={t("language_desc")}
            control={<LanguagePreference />}
          />
          <SettingsRow
            label={t("theme_variant")}
            description={t("variant_desc")}
            control={<VariantPreference />}
          />
          <SettingsRow>
            <RankingPreferenceToggle variant="settings" />
          </SettingsRow>
          {profile ? (
            <SettingsRow>
              <PublicIdentityToggle
                profile={profile}
                onProfileChange={setProfile}
              />
            </SettingsRow>
          ) : null}
        </SettingsGroup>

        <AccountSection isAuthenticated={isAuthenticated} t={t} />

        <SettingsGroup label={t("legal")}>
          <SettingsRow label={t("privacy")} href="/privacy" />
          <SettingsRow label={t("terms")} href="/terms" />
          <SettingsRow label={t("about")} href="/about" />
        </SettingsGroup>
      </main>
    </div>
  );
}
