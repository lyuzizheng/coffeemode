"use client";

import { Button, Drawer, Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { PlusIcon } from "@/components/icons";
import { CafePlaceSearch } from "./cafe-place-search";
import { CafeCreationForm } from "./cafe-creation-form";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { apiErrorMessage, apiFetch, isUnauthorized } from "@/lib/http";
import { resolvePrediction } from "@/lib/places/resolve-prediction";
import type { POI, PlacePrediction } from "@shared/places/types";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";

async function persistExternalPlace(selected: POI, messages: { failed: string; notFood: string }): Promise<string | null> {
  try {
    // `POST /api/places/external` requires auth; a dead session reaches the
    // drawer's gate as the shared marker rather than this alert slot.
    const result = await apiFetch<{
      stored?: number;
      skipped?: Array<{ index?: number; reason?: string }>;
    }>("/api/places/external", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pois: [selected] }),
    });
    // BRAWUKA-328: the worker skips non-food/category POIs instead of storing
    // them. The form must not accept the place — it can never resolve to a cafe.
    if (result && Array.isArray(result.skipped) && result.skipped.length > 0) {
      return messages.notFood;
    }
    return null;
  } catch (cause) {
    if (isUnauthorized(cause)) throw cause;
    return apiErrorMessage(cause, messages.failed);
  }
}

interface CafeCreationPaneProps {
  searchKey: number;
  poi: POI | null;
  name: string;
  error: string | null;
  isAuthenticated: boolean;
  /** DG143 request-time MapKit readiness, drilled from the server page. */
  mapkitConfigured: boolean;
  /** BRAWUKA-366: provider CTA tapped upstream — seeds the search tab's
   * provider chip instead of the registry default. */
  initialProvider?: ExternalSearchProvider | null;
  showSignInGate: boolean;
  /** BRAWUKA-602: a live search pick is being resolved into a POI. */
  resolving: boolean;
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
  mapkitConfigured,
  initialProvider,
  showSignInGate,
  resolving,
  onSelectPOI,
  onNameChange,
  onError,
  onRequireSignIn,
}: CafeCreationPaneProps) {
  const t = useTranslations("create");

  return (
    <Drawer.Body className="overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-5 pb-4">
        <CafePlaceSearch
          key={searchKey}
          mapkitConfigured={mapkitConfigured}
          initialProvider={initialProvider}
          onSelectPOI={onSelectPOI}
          onError={onError}
          onRequireSignIn={onRequireSignIn}
        />

        {resolving ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner size="sm" />
            {t("resolvingPlace")}
          </p>
        ) : null}

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
function usePlaceSelection(
  requireSignIn: () => void,
  messages: { failed: string; notFood: string },
  /** BRAWUKA-364: a POI picked upstream (unified search) seeds the form
   * step once per mount — the parent keys the sheet by poi so a new pick
   * remounts. `persist` mirrors selectPlace's flag for external places.
   * BRAWUKA-602: a live search result arrives as a prediction instead, and is
   * resolved through the billed Place Details call before the form may use it. */
  seed?: { poi: POI | null; persist: boolean; prediction?: PlacePrediction; session?: string },
) {
  // A non-persisting seed is pure state, so it is derived at mount rather than
  // set from an effect (react-hooks/set-state-in-effect). Only the async paths
  // — an external persist, or a prediction's Place Details call — need one.
  const inlineSeed = seed?.poi && !seed.persist ? seed.poi : null;
  const [poi, setPoi] = useState<POI | null>(inlineSeed);
  const [name, setName] = useState(inlineSeed?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(Boolean(seed?.prediction));

  const applyPlace = (selected: POI) => {
    setPoi(selected);
    setName(selected.name);
  };

  /** Persist an external place, then apply it. Every setState here is inside
   *  an async callback, so the seed effect can call it without a synchronous
   *  state write (react-hooks/set-state-in-effect). */
  const persistPlace = (selected: POI) =>
    persistExternalPlace(selected, messages)
      .then((failure) => {
        setError(failure);
        if (!failure) applyPlace(selected);
      })
      .catch((cause: unknown) => {
        // Retrying the same write is the same 401.
        if (isUnauthorized(cause)) requireSignIn();
      });

  const selectPlace = (selected: POI, persist = false) => {
    if (!persist) {
      setError(null);
      applyPlace(selected);
      return;
    }
    void persistPlace(selected);
  };

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (seed?.poi && seed.persist) {
      void persistPlace(seed.poi);
      return;
    }
    if (seed?.prediction) {
      resolvePrediction(seed.prediction, seed.session)
        .then(applyPlace)
        .catch((cause: unknown) => {
          if (isUnauthorized(cause)) requireSignIn();
          else setError(apiErrorMessage(cause, messages.failed));
        })
        .finally(() => setResolving(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setPoi(null);
    setName("");
    setError(null);
  };

  return { poi, name, setName, error, setError, selectPlace, reset, resolving };
}

interface CafeCreationSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isAuthenticated?: boolean;
  /** DG143 request-time MapKit readiness; defaults off. */
  mapkitConfigured?: boolean;
  /** BRAWUKA-364: a POI picked upstream (unified search) opens the sheet
   * already on the form step; `initialPersist` mirrors selectPlace's
   * persist flag for client-side external (Apple MapKit) places. */
  initialPoi?: POI | null;
  initialPersist?: boolean;
  /** BRAWUKA-602: a live search result picked upstream — the sheet resolves
   * it through the billed Place Details call before showing the form. */
  initialPrediction?: PlacePrediction | null;
  /** Autocomplete session `initialPrediction` was produced under. */
  initialSession?: string;
  /** BRAWUKA-366: a provider CTA tapped upstream (unified search) opens the
   * sheet's place search on that provider's tab. */
  initialProvider?: ExternalSearchProvider | null;
}

export function CafeCreationSheet({
  isOpen,
  onOpenChange,
  isAuthenticated = true,
  mapkitConfigured = false,
  initialPoi = null,
  initialPersist = false,
  initialPrediction = null,
  initialSession,
  initialProvider = null,
}: CafeCreationSheetProps) {
  const t = useTranslations("create");
  const [searchKey, setSearchKey] = useState(0);
  const [showSignInGate, setShowSignInGate] = useState(false);

  // One gate for the whole drawer: place search, external-place persist and the
  // creation form all die the same way when the session expires (BRAWUKA-212).
  const requireSignIn = useCallback(() => setShowSignInGate(true), []);
  const place = usePlaceSelection(
    requireSignIn,
    { failed: t("searchFailed"), notFood: t("notFoodPlace") },
    {
      poi: initialPoi,
      persist: initialPersist,
      ...(initialPrediction ? { prediction: initialPrediction } : {}),
      ...(initialSession ? { session: initialSession } : {}),
    },
  );

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
      {/* BRAWUKA-371: Content MUST nest inside Backdrop — see
          checkin-drawer.tsx for why sibling placement leaks the backdrop. */}
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog className="max-h-[92dvh] !pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <Drawer.Handle />
            <Drawer.Header>
              <Drawer.Heading>{t("title")}</Drawer.Heading>
              <p className="text-sm text-muted">{t("firstCheckinHint")}</p>
            </Drawer.Header>
            <CafeCreationPane
              searchKey={searchKey}
              poi={place.poi}
              name={place.name}
              error={place.error}
              isAuthenticated={isAuthenticated}
              mapkitConfigured={mapkitConfigured}
              initialProvider={initialProvider}
              showSignInGate={showSignInGate}
              resolving={place.resolving}
              onSelectPOI={place.selectPlace}
              onNameChange={place.setName}
              onError={place.setError}
              onRequireSignIn={requireSignIn}
            />
            <Drawer.Footer>
              <Drawer.CloseTrigger className="cm-focus min-h-11 rounded-sm border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-secondary">
                {t("close")}
              </Drawer.CloseTrigger>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  );
}

export function CafeCreationTrigger({
  isAuthenticated,
  mapkitConfigured,
  variant = "primary",
}: {
  isAuthenticated: boolean;
  /** DG143 request-time MapKit readiness from the server page. */
  mapkitConfigured: boolean;
  /** BRAWUKA-364: "primary" is the empty-state CTA; "compact" the masthead
   * action; "fab" the floating round button (positioning is the host's). */
  variant?: "primary" | "compact" | "fab";
}) {
  const t = useTranslations("create");
  const [isOpen, setIsOpen] = useState(false);
  const { isOnline } = useNetworkStatus();

  const trigger =
    variant === "fab" ? (
      <Button
        variant="primary"
        isIconOnly
        isDisabled={!isOnline}
        aria-label={isOnline ? t("title") : t("offline")}
        className="h-12 w-12 min-w-12 rounded-full shadow-lg"
        onPress={() => setIsOpen(true)}
      >
        <PlusIcon size={20} />
      </Button>
    ) : (
      <Button
        variant="primary"
        size={variant === "compact" ? "sm" : "md"}
        isDisabled={!isOnline}
        onPress={() => setIsOpen(true)}
      >
        {isOnline ? t("title") : t("offline")}
      </Button>
    );

  return (
    <>
      {trigger}
      <CafeCreationSheet
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        isAuthenticated={isAuthenticated}
        mapkitConfigured={mapkitConfigured}
      />
    </>
  );
}
