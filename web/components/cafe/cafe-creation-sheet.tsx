"use client";

import { Button, Drawer } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { CafePlaceSearch } from "./cafe-place-search";
import { CafeCreationForm } from "./cafe-creation-form";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { isUnauthorized, responseMessage, throwIfUnauthorized } from "@/lib/http";
import type { POI } from "@shared/places/types";

async function persistExternalPlace(selected: POI, fallback: string): Promise<string | null> {
  try {
    const response = await fetch("/api/places/external", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pois: [selected] }),
    });
    // `POST /api/places/external` requires auth; a dead session reaches the
    // drawer's gate as the shared marker rather than this alert slot.
    throwIfUnauthorized(response);
    if (!response.ok) {
      return await responseMessage(response, fallback);
    }
    return null;
  } catch (cause) {
    if (isUnauthorized(cause)) throw cause;
    return cause instanceof Error ? cause.message : fallback;
  }
}

interface CafeCreationPaneProps {
  searchKey: number;
  poi: POI | null;
  name: string;
  error: string | null;
  isAuthenticated: boolean;
  showSignInGate: boolean;
  onSelectPOI: (selected: POI, persist?: boolean) => void;
  onNameChange: (name: string) => void;
  onError: (error: string | null) => void;
  onRequireSignIn: () => void;
}

/** Drawer body: search → the place's first check-in form → the gate. */
function CafeCreationPane({
  searchKey,
  poi,
  name,
  error,
  isAuthenticated,
  showSignInGate,
  onSelectPOI,
  onNameChange,
  onError,
  onRequireSignIn,
}: CafeCreationPaneProps) {
  const t = useTranslations("create");

  return (
    <Drawer.Body className="overflow-y-auto px-4">
      <div className="mx-auto w-full max-w-2xl space-y-5 pb-4">
        <CafePlaceSearch
          key={searchKey}
          onSelectPOI={onSelectPOI}
          onError={onError}
          onRequireSignIn={onRequireSignIn}
        />

        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {poi ? (
          <CafeCreationForm
            poi={poi}
            name={name}
            onNameChange={onNameChange}
            isAuthenticated={isAuthenticated}
            onError={onError}
            onRequireSignIn={onRequireSignIn}
          />
        ) : null}

        {showSignInGate ? <SignInGate message={t("signInRequired")} /> : null}
      </div>
    </Drawer.Body>
  );
}

/**
 * Place selection for the drawer. An Apple place is persisted before the form
 * may use it; a dead session on that write goes to the sign-in gate rather than
 * to the alert slot, because only signing in can clear it (BRAWUKA-212).
 */
function usePlaceSelection(requireSignIn: () => void, persistFailed: string) {
  const [poi, setPoi] = useState<POI | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const applyPlace = (selected: POI) => {
    setPoi(selected);
    setName(selected.name);
  };

  const selectPlace = (selected: POI, persist = false) => {
    setError(null);
    if (!persist) {
      applyPlace(selected);
      return;
    }
    void persistExternalPlace(selected, persistFailed)
      .then((failure) => {
        if (failure) {
          setError(failure);
          return;
        }
        applyPlace(selected);
      })
      .catch((cause: unknown) => {
        // Retrying the same write is the same 401.
        if (isUnauthorized(cause)) requireSignIn();
      });
  };

  const reset = () => {
    setPoi(null);
    setName("");
    setError(null);
  };

  return { poi, name, setName, error, setError, selectPlace, reset };
}

export function CafeCreationSheet({
  isOpen,
  onOpenChange,
  isAuthenticated = true,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isAuthenticated?: boolean;
}) {
  const t = useTranslations("create");
  const [searchKey, setSearchKey] = useState(0);
  const [showSignInGate, setShowSignInGate] = useState(false);

  // One gate for the whole drawer: place search, external-place persist and the
  // creation form all die the same way when the session expires (BRAWUKA-212).
  const requireSignIn = useCallback(() => setShowSignInGate(true), []);
  const place = usePlaceSelection(requireSignIn, t("searchFailed"));

  const reset = () => {
    place.reset();
    setShowSignInGate(false);
    setSearchKey((k) => k + 1);
  };

  return (
    <Drawer.Root
      isOpen={isOpen}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Drawer.Backdrop />
      <Drawer.Content placement="bottom">
        <Drawer.Dialog className="max-h-[92dvh] !pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <Drawer.Handle />
          <Drawer.Header className="px-4">
            <Drawer.Heading>{t("title")}</Drawer.Heading>
            <p className="text-sm text-muted">{t("firstCheckinHint")}</p>
          </Drawer.Header>
          <CafeCreationPane
            searchKey={searchKey}
            poi={place.poi}
            name={place.name}
            error={place.error}
            isAuthenticated={isAuthenticated}
            showSignInGate={showSignInGate}
            onSelectPOI={place.selectPlace}
            onNameChange={place.setName}
            onError={place.setError}
            onRequireSignIn={requireSignIn}
          />
          <Drawer.Footer className="px-4">
            <Drawer.CloseTrigger className="cm-focus rounded-sm border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-secondary">
              {t("close")}
            </Drawer.CloseTrigger>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export function CafeCreationTrigger({ isAuthenticated }: { isAuthenticated: boolean }) {
  const t = useTranslations("create");
  const [isOpen, setIsOpen] = useState(false);
  const { isOnline } = useNetworkStatus();

  return (
    <>
      <Button variant="primary" isDisabled={!isOnline} onPress={() => setIsOpen(true)}>
        {isOnline ? t("title") : t("offline")}
      </Button>
      <CafeCreationSheet isOpen={isOpen} onOpenChange={setIsOpen} isAuthenticated={isAuthenticated} />
    </>
  );
}
