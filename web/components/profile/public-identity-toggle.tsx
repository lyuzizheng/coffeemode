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
import { apiErrorMessage, apiFetch, isUnauthorized } from "@/lib/http";
import { SignInGate } from "@/components/auth/sign-in-gate";

interface IdentityPatchBody {
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
  const tApi = useTranslations();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // A 401 mid-edit means the session died under a mounted settings page —
  // swap the control for the shared gate (BRAWUKA-540 review P1).
  const [sessionExpired, setSessionExpired] = useState(false);
  const [handleDraft, setHandleDraft] = useState<string | null>(null);

  async function patchIdentity(
    body: { showPublicIdentity: boolean; publicHandle?: string },
    optimistic: UserProfileDto,
    previous: UserProfileDto,
  ) {
    setPending(true);
    setErrorMessage(null);
    onProfileChange(optimistic);
    try {
      const data = await apiFetch<IdentityPatchBody>("/api/profile/identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // The envelope guarantees no error-in-2xx (spec 0011): a missing body
      // is the only residual failure shape here.
      if (!data) {
        onProfileChange(previous);
        setErrorMessage(tApi("profile.identity_error_generic"));
        return;
      }
      onProfileChange(mergeIdentity(optimistic, data));
      setHandleDraft(null);
    } catch (cause) {
      onProfileChange(previous);
      if (isUnauthorized(cause)) {
        setSessionExpired(true);
        return;
      }
      setErrorMessage(apiErrorMessage(cause, tApi("profile.identity_error_generic"), tApi));
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

  // Rows, not cards: the parent Preferences section owns the grouped card
  // chrome (`divide-y` separators), so each control renders as a plain row.
  if (sessionExpired) {
    return (
      <div className="px-4 py-3">
        <SignInGate message={t("sign_in_to_save")} next="/settings" />
      </div>
    );
  }

  return (
    <>
      <div className="px-4 py-3">
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

      <div className="flex items-center justify-between gap-3 px-4 py-3">
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
              className="w-full rounded-md border border-accent bg-surface-secondary px-2 py-1 min-h-11 text-sm text-foreground outline-none"
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
              className="-my-1"
            >
              {t("save")}
            </Button>
            <Button size="sm" variant="outline" onPress={() => setHandleDraft(null)} className="-my-1">
              {t("cancel")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHandleDraft(profile.publicHandle ?? "")}
            disabled={pending}
            aria-label={t("public_handle_label")}
            className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-all hover:text-foreground active:scale-95"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L4.5 13.5l-3 0.5 0.5-3L11.5 2.5Z" />
            </svg>
          </button>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          {errorMessage}
        </p>
      )}
    </>
  );
}
