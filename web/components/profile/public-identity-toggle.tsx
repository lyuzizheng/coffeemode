"use client";

/**
 * Opt-in public author identity (spec 0006 Q1/Q7, Stage 3).
 *
 * One global switch bound to `PATCH /api/profile/identity`: unchecked means
 * anonymous (the MVP default), checked publishes the author's name/avatar on
 * cafes they create and check-ins they post. The toggling user's own view
 * updates optimistically; everyone else may see the old state for up to the
 * CDN/SWR window (accepted risk Q6).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Label, Switch } from "@heroui/react";
import type { UserProfileDto } from "@/lib/db/profile";
import { getHandleMaxChars } from "@/lib/client-env";

type IdentityErrorKey =
  | "identity_error_handle_taken"
  | "identity_error_handle_too_soon"
  | "identity_error_invalid_handle"
  | "identity_error_generic";

function errorKeyFor(code: string | undefined): IdentityErrorKey {
  switch (code) {
    case "handle_taken":
      return "identity_error_handle_taken";
    case "handle_change_too_soon":
      return "identity_error_handle_too_soon";
    case "invalid_handle":
      return "identity_error_invalid_handle";
    default:
      return "identity_error_generic";
  }
}

interface IdentityPatchBody {
  ok?: boolean;
  error?: string;
  showPublicIdentity?: boolean;
  publicHandle?: string | null;
  identityConsentedAt?: string | null;
  publicHandleChangedAt?: string | null;
}

function mergeIdentity(profile: UserProfileDto, body: IdentityPatchBody): UserProfileDto {
  return {
    ...profile,
    showPublicIdentity: body.showPublicIdentity ?? profile.showPublicIdentity,
    publicHandle: body.publicHandle !== undefined ? body.publicHandle : profile.publicHandle,
    identityConsentedAt:
      body.identityConsentedAt !== undefined ? body.identityConsentedAt : profile.identityConsentedAt,
    publicHandleChangedAt:
      body.publicHandleChangedAt !== undefined
        ? body.publicHandleChangedAt
        : profile.publicHandleChangedAt,
  };
}

export function PublicIdentityToggle({
  profile,
  onProfileChange,
}: {
  profile: UserProfileDto;
  onProfileChange: (updated: UserProfileDto) => void;
}) {
  const t = useTranslations("profile");
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<IdentityErrorKey | null>(null);
  const [handleDraft, setHandleDraft] = useState<string | null>(null);

  async function patchIdentity(
    body: { showPublicIdentity: boolean; publicHandle?: string },
    optimistic: UserProfileDto,
    previous: UserProfileDto,
  ) {
    setPending(true);
    setErrorKey(null);
    onProfileChange(optimistic);
    try {
      const res = await fetch("/api/profile/identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as IdentityPatchBody | null;
      if (!res.ok || !data || data.ok === false) {
        onProfileChange(previous);
        setErrorKey(errorKeyFor(data?.error));
        return;
      }
      onProfileChange(mergeIdentity(optimistic, data));
      setHandleDraft(null);
    } catch {
      onProfileChange(previous);
      setErrorKey(errorKeyFor(undefined));
    } finally {
      setPending(false);
    }
  }

  const handleToggle = (next: boolean) => {
    if (pending || next === profile.showPublicIdentity) return;
    void patchIdentity(
      { showPublicIdentity: next },
      { ...profile, showPublicIdentity: next },
      profile,
    );
  };

  const handleSaveHandle = () => {
    const trimmed = (handleDraft ?? "").trim();
    if (pending || trimmed.length === 0) return;
    void patchIdentity(
      { showPublicIdentity: profile.showPublicIdentity, publicHandle: trimmed },
      profile,
      profile,
    );
  };

  return (
    <section aria-label={t("public_identity_label")} className="flex flex-col gap-2">
      <div className="rounded-xl border border-border bg-surface p-4">
        <Switch
          isSelected={profile.showPublicIdentity}
          onChange={handleToggle}
          isDisabled={pending}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm text-foreground">{t("public_identity_label")}</Label>
          </Switch.Content>
        </Switch>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{t("public_handle_label")}</span>
          {handleDraft !== null ? (
            <input
              type="text"
              maxLength={getHandleMaxChars()}
              value={handleDraft}
              onChange={(e) => setHandleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveHandle();
                if (e.key === "Escape") setHandleDraft(null);
              }}
              autoFocus
              placeholder={t("public_handle_placeholder")}
              className="w-full rounded-md border border-accent bg-surface-secondary px-2 py-1 text-sm text-foreground outline-none"
            />
          ) : (
            <span className="truncate text-sm text-muted">
              {profile.publicHandle ? `@${profile.publicHandle}` : "—"}
            </span>
          )}
        </div>
        {handleDraft !== null ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onPress={handleSaveHandle}
              isDisabled={pending || handleDraft.trim().length === 0}
            >
              {t("save")}
            </Button>
            <Button size="sm" variant="outline" onPress={() => setHandleDraft(null)}>
              {t("cancel")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHandleDraft(profile.publicHandle ?? "")}
            disabled={pending}
            aria-label={t("public_handle_label")}
            className="shrink-0 rounded-full p-1 text-muted transition-all hover:text-foreground active:scale-95"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L4.5 13.5l-3 0.5 0.5-3L11.5 2.5Z" />
            </svg>
          </button>
        )}
      </div>

      {errorKey && (
        <p role="alert" className="text-sm text-danger">
          {t(errorKey)}
        </p>
      )}
    </section>
  );
}
