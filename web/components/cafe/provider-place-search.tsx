"use client";

import { Button, SearchField, Spinner } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { apiErrorMessage, isUnauthorized } from "@/lib/http";
import { readOnboardingState } from "@/lib/onboarding-store";
import type { CreateTranslator, PlaceCandidate, PlaceSearchProvider } from "@/lib/places/place-search";
import type { POI } from "@shared/places/types";
import type { ExternalSearchProvider } from "@/components/search/search-results-list";

interface ProviderPlaceSearchProps {
  /** Owned by the coordinator's tab state. The panel stays mounted when
   * inactive so query, provider selection and candidates survive tab
   * switches; `active` only toggles visibility — provider init timing is
   * mount-time, matching the pre-split behavior. */
  active: boolean;
  providers: PlaceSearchProvider[];
  initialProvider: ExternalSearchProvider | null;
  onSelectPOI: (poi: POI, persist?: boolean) => void;
  onError: (error: string | null) => void;
  onRequireSignIn: () => void;
}

// Provider init (script load / token fetch) runs on selection — a dead
// session on the token fetch routes to the drawer's sign-in gate, every
// other failure surfaces as the provider's unavailable error in the shared
// alert slot.
// Readiness is derived per provider id (state-during-render pattern), so
// the effect only fires the async init, never sets state synchronously.
function useProviderReady(
  provider: PlaceSearchProvider | null,
  onError: (error: string | null) => void,
  onRequireSignIn: () => void,
  t: CreateTranslator,
) {
  const [readyProviderId, setReadyProviderId] = useState<string | null>(null);
  const providerReady = provider !== null && (!provider.init || readyProviderId === provider.id);
  useEffect(() => {
    if (!provider?.init) return;
    let cancelled = false;
    provider
      .init()
      .then(() => {
        if (!cancelled) setReadyProviderId(provider.id);
      })
      .catch((cause) => {
        if (cancelled) return;
        // A dead session on the token fetch is the same expired session the
        // Google search and persist paths route to the drawer's gate
        // (BRAWUKA-212): only signing in can clear it.
        if (isUnauthorized(cause)) {
          onRequireSignIn();
          return;
        }
        onError(t("searchFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [provider, onError, onRequireSignIn, t]);
  return providerReady;
}

interface CandidateListProps {
  candidates: PlaceCandidate[];
  resolvingId: string | null;
  providerLabel: string | undefined;
  onSelect: (candidate: PlaceCandidate) => void;
  t: CreateTranslator;
}

function CandidateList({ candidates, resolvingId, providerLabel, onSelect, t }: CandidateListProps) {
  return (
    <div className="space-y-2" aria-label={t("searchResults")}>
      {candidates.map((candidate) => (
        <button
          key={candidate.prediction.place_id}
          type="button"
          disabled={resolvingId !== null}
          className="cm-focus flex w-full items-start justify-between gap-3 rounded-md border border-border bg-surface p-3 text-left hover:bg-surface-secondary disabled:opacity-60"
          onClick={() => void onSelect(candidate)}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {candidate.prediction.name}
            </span>
            <span className="mt-1 block truncate text-xs text-muted">
              {candidate.prediction.address ?? t("noAddress")}
            </span>
          </span>
          <span className="shrink-0 font-mono text-xs uppercase text-muted">
            {resolvingId === candidate.prediction.place_id ? (
              <Spinner size="sm" />
            ) : (
              providerLabel
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

interface ProviderSearchActionsArgs {
  provider: PlaceSearchProvider | null;
  providerReady: boolean;
  query: string;
  onSelectPOI: (poi: POI, persist?: boolean) => void;
  onError: (error: string | null) => void;
  onRequireSignIn: () => void;
}

/** Query submit and billed candidate-selection transitions. */
function useProviderSearchActions(args: ProviderSearchActionsArgs) {
  const { provider, providerReady, query, onSelectPOI, onError, onRequireSignIn } = args;
  const t = useTranslations("create");
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || !provider || !providerReady) return;
    setSearching(true);
    onError(null);
    try {
      // Bias live results toward the user's known center (BRAWUKA-280).
      const bias = readOnboardingState()?.lastLocation ?? null;
      setCandidates(await provider.search(query.trim(), bias ?? undefined));
    } catch (cause) {
      if (isUnauthorized(cause)) {
        onRequireSignIn();
        return;
      }
      onError(apiErrorMessage(cause, t("searchFailed")));
    } finally {
      setSearching(false);
    }
  };

  // Selection is the billed half of the two-phase search (BRAWUKA-602): the
  // provider turns the prediction into a full POI here, and only then does the
  // sheet move on to the form.
  const handleSelectCandidate = async (candidate: PlaceCandidate) => {
    if (!provider || resolvingId !== null) return;
    setResolvingId(candidate.prediction.place_id);
    onError(null);
    try {
      const poi = await provider.resolve(candidate);
      setCandidates([]);
      onSelectPOI(poi, provider.persistOnSelect);
    } catch (cause) {
      if (isUnauthorized(cause)) {
        onRequireSignIn();
        return;
      }
      onError(apiErrorMessage(cause, t("searchFailed")));
    } finally {
      setResolvingId(null);
    }
  };

  return { candidates, setCandidates, searching, resolvingId, handleSearch, handleSelectCandidate };
}

export function ProviderPlaceSearch({
  active,
  providers,
  initialProvider,
  onSelectPOI,
  onError,
  onRequireSignIn,
}: ProviderPlaceSearchProps) {
  const t = useTranslations("create");
  const [provider, setProvider] = useState<PlaceSearchProvider | null>(
    () => providers.find((candidate) => candidate.id === initialProvider) ?? providers[0] ?? null,
  );
  const [query, setQuery] = useState("");
  const providerReady = useProviderReady(provider, onError, onRequireSignIn, t);
  const { candidates, setCandidates, searching, resolvingId, handleSearch, handleSelectCandidate } =
    useProviderSearchActions({
      provider,
      providerReady,
      query,
      onSelectPOI,
      onError,
      onRequireSignIn,
    });

  const handleProviderSelect = (candidate: PlaceSearchProvider) => {
    setProvider(candidate);
    setCandidates([]);
    onError(null);
  };
  return (
    <div className="space-y-3" hidden={!active}>
      <div className="flex gap-2" role="group" aria-label={t("provider")}>
        {providers.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            aria-pressed={provider?.id === candidate.id}
            onClick={() => handleProviderSelect(candidate)}
            className={`cm-focus flex h-9 items-center rounded-sm border px-3 text-xs font-medium ${
              provider?.id === candidate.id
                ? "border-secondary bg-secondary text-secondary-foreground"
                : "border-border bg-surface-secondary text-foreground"
            }`}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      {!providerReady ? (
        <p className="text-sm text-muted">{t("providerLoading")}</p>
      ) : (
        <form className="flex gap-2" onSubmit={handleSearch}>
          <SearchField className="min-w-0 flex-1" value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("searchPlaceholder")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button type="submit" variant="secondary" isDisabled={searching || !query.trim()}>
            {searching ? <Spinner size="sm" /> : t("searchAction")}
          </Button>
        </form>
      )}
      {candidates.length > 0 ? (
        <CandidateList
          candidates={candidates}
          resolvingId={resolvingId}
          providerLabel={provider?.label}
          onSelect={handleSelectCandidate}
          t={t}
        />
      ) : null}
    </div>
  );
}
