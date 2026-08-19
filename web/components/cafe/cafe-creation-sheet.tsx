"use client";

import {
  Button,
  Card,
  Chip,
  Drawer,
  Input,
  Label,
  SearchField,
  Slider,
  Spinner,
  TextArea,
  TextField,
} from "@heroui/react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ApplePlaceSearch } from "@/components/cafe/apple-place-search";
import { MAX_STAY_VALUES, MIN_SPEND_VALUES, type MaxStay, type MinSpend } from "@/types/checkins";
import type { UploadUrlResponse } from "@/types/images";
import type { POI, POISearchResponse } from "@shared/places/types";

type EntryMode = "link" | "search";
type SearchProvider = "google" | "apple";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function policyOptions(values: readonly string[], labels: Record<string, string>) {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

function toWebP(file: File): Promise<Blob> {
  if (file.type === "image/webp") return Promise.resolve(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("photo_conversion_failed"))),
        "image/webp",
        0.9,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("photo_conversion_failed"));
    };
    image.src = objectUrl;
  });
}

async function uploadPhoto(file: File): Promise<string> {
  const webp = await toWebP(file);
  if (webp.size > MAX_UPLOAD_BYTES) throw new Error("photo_too_large");

  const uploadResponse = await fetch("/api/images/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ size: webp.size }),
  });
  const uploadData = (await uploadResponse.json().catch(() => null)) as UploadUrlResponse | null;
  if (!uploadResponse.ok || !uploadData?.uploadUrl || !uploadData.imageUuid) {
    throw new Error("photo_upload_failed");
  }

  const putResponse = await fetch(uploadData.uploadUrl, {
    method: "PUT",
    headers: uploadData.uploadHeaders,
    body: webp,
  });
  if (!putResponse.ok) throw new Error("photo_upload_failed");
  return uploadData.imageUuid;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return body?.message || body?.error || fallback;
}

function PolicyChips<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            onClick={() => onSelect(option.value)}
            className={`cm-focus h-9 rounded-sm border px-3 text-xs font-medium transition-colors duration-150 ${
              selected === option.value
                ? "border-secondary bg-secondary text-secondary-foreground"
                : "border-border bg-surface-secondary text-foreground hover:bg-surface-tertiary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function POIPreview({ poi, name, onNameChange }: { poi: POI; name: string; onNameChange: (name: string) => void }) {
  const t = useTranslations("create");
  return (
    <Card className="border-border bg-surface-secondary">
      <Card.Header>
        <div className="flex items-center justify-between gap-3">
          <Card.Title>{t("previewTitle")}</Card.Title>
          <Chip variant="soft">{poi.source === "google" ? "Google" : "Apple"}</Chip>
        </div>
        <Card.Description>{t("previewHint")}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4">
        <TextField className="w-full" isRequired>
          <Label>{t("name")}</Label>
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} />
        </TextField>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{t("location")}</div>
          <p className="mt-1 text-sm text-foreground">{poi.address ?? t("noAddress")}</p>
          <p className="mt-1 font-mono text-[0.65rem] text-muted">
            {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}
          </p>
        </div>
      </Card.Content>
    </Card>
  );
}

export function CafeCreationSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const t = useTranslations("create");
  const ts = useTranslations("search");
  const [entryMode, setEntryMode] = useState<EntryMode>("link");
  const [provider, setProvider] = useState<SearchProvider>("google");
  const [mapsUrl, setMapsUrl] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<POI[]>([]);
  const [poi, setPoi] = useState<POI | null>(null);
  const [name, setName] = useState("");
  const [overall, setOverall] = useState<number | null>(null);
  const [minSpend, setMinSpend] = useState<MinSpend>("unknown");
  const [maxStay, setMaxStay] = useState<MaxStay>("unknown");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateCafeId, setDuplicateCafeId] = useState<string | null>(null);
  const [createdCafeId, setCreatedCafeId] = useState<string | null>(null);

  const reset = () => {
    setEntryMode("link");
    setProvider("google");
    setMapsUrl("");
    setQuery("");
    setSearchResults([]);
    setPoi(null);
    setName("");
    setOverall(null);
    setMinSpend("unknown");
    setMaxStay("unknown");
    setNote("");
    setPhoto(null);
    setBusy(false);
    setSearching(false);
    setError(null);
    setDuplicateCafeId(null);
    setCreatedCafeId(null);
  };

  const selectPOI = async (selected: POI, persist = false) => {
    setError(null);
    if (persist) {
      const response = await fetch("/api/places/external", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pois: [selected] }),
      });
      if (!response.ok) {
        setError(await responseMessage(response, t("searchFailed")));
        return;
      }
    }
    setPoi(selected);
    setName(selected.name);
    setSearchResults([]);
  };

  const resolveLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!mapsUrl.trim()) return;
    setBusy(true);
    setError(null);
    setPoi(null);
    try {
      const response = await fetch("/api/places/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maps_share_url: mapsUrl.trim() }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("resolveFailed")));
      await selectPOI((await response.json()) as POI);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("resolveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const searchGoogle = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/places/search?source=google&q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error(await responseMessage(response, t("searchFailed")));
      const data = (await response.json()) as POISearchResponse;
      setSearchResults(data.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const createCafe = async (event: FormEvent) => {
    event.preventDefault();
    if (!navigator.onLine) {
      setError(t("offline"));
      return;
    }
    if (!poi || overall === null || !note.trim() || !photo || !name.trim()) {
      setError(t("requiredFields"));
      return;
    }
    setBusy(true);
    setError(null);
    setDuplicateCafeId(null);
    try {
      const imageUuid = await uploadPhoto(photo);
      const body = {
        name: name.trim(),
        lat: poi.lat,
        lng: poi.lng,
        address: poi.address ?? undefined,
        ...(poi.source === "google" ? { google_place_id: poi.place_id } : { apple_poi_id: poi.place_id }),
        checkin: {
          scores: { overall },
          min_spend: minSpend,
          max_stay: maxStay,
          note: note.trim(),
          photo_ids: [imageUuid],
        },
      };
      const response = await fetch("/api/cafes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 409) {
        const duplicate = (await response.json()) as { cafe_id?: string };
        setDuplicateCafeId(duplicate.cafe_id ?? null);
        return;
      }
      if (!response.ok) throw new Error(await responseMessage(response, t("createFailed")));
      const result = (await response.json()) as { cafeId?: string };
      setCreatedCafeId(result.cafeId ?? null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("createFailed");
      setError(
        message === "photo_too_large"
          ? t("photoTooLarge")
          : message === "photo_upload_failed" || message === "photo_conversion_failed"
            ? t("photoUploadFailed")
            : message,
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    setPhoto(event.target.files?.[0] ?? null);
    setError(null);
  };

  const minSpendLabels = Object.fromEntries(
    MIN_SPEND_VALUES.map((value) => [value, ts(`minSpendOptions.${value}`)]),
  ) as Record<string, string>;
  const maxStayLabels = Object.fromEntries(
    MAX_STAY_VALUES.map((value) => [value, ts(`maxStayOptions.${value}`)]),
  ) as Record<string, string>;

  return (
    <Drawer.Root
      isOpen={isOpen}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Drawer.Backdrop />
      <Drawer.Content placement="bottom" className="max-h-[92dvh]">
        <Drawer.Dialog>
          <Drawer.Handle />
          <Drawer.Header>
            <Drawer.Heading>{t("title")}</Drawer.Heading>
            <p className="text-sm text-muted">{t("firstCheckinHint")}</p>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-5 pb-4">
              <div className="grid grid-cols-2 gap-1 border-b border-border" role="tablist" aria-label={t("entryMethods")}>
                {(["link", "search"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={entryMode === mode}
                    onClick={() => {
                      setEntryMode(mode);
                      setError(null);
                    }}
                    className={`cm-focus border-b-2 px-3 py-3 text-sm font-medium ${
                      entryMode === mode ? "border-accent text-foreground" : "border-transparent text-muted"
                    }`}
                  >
                    {mode === "link" ? t("importLink") : t("searchPlace")}
                  </button>
                ))}
              </div>

              {entryMode === "link" ? (
                <form className="space-y-3" onSubmit={resolveLink}>
                  <p className="text-sm text-muted">{t("importHint")}</p>
                  <div className="flex gap-2">
                    <TextField className="min-w-0 flex-1">
                      <Label className="sr-only">{t("mapsLink")}</Label>
                      <Input
                        value={mapsUrl}
                        onChange={(event) => setMapsUrl(event.target.value)}
                        placeholder={t("mapsLinkPlaceholder")}
                        type="url"
                      />
                    </TextField>
                    <Button type="submit" variant="secondary" isDisabled={busy || !mapsUrl.trim()}>
                      {busy ? <Spinner size="sm" /> : t("resolveLink")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-2" role="group" aria-label={t("provider")}>
                    {(["google", "apple"] as const).map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        aria-pressed={provider === candidate}
                        onClick={() => {
                          setProvider(candidate);
                          setSearchResults([]);
                          setError(null);
                        }}
                        className={`cm-focus rounded-sm border px-3 py-2 text-xs font-medium ${
                          provider === candidate
                            ? "border-secondary bg-secondary text-secondary-foreground"
                            : "border-border bg-surface-secondary text-foreground"
                        }`}
                      >
                        {candidate === "google" ? t("google") : t("apple")}
                      </button>
                    ))}
                  </div>
                  {provider === "google" ? (
                    <form className="flex gap-2" onSubmit={searchGoogle}>
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
                  ) : (
                    <ApplePlaceSearch onSelect={(selected) => void selectPOI(selected, true)} />
                  )}
                  {searchResults.length > 0 ? (
                    <div className="space-y-2" aria-label={t("searchResults")}>
                      {searchResults.map((result) => (
                        <button
                          key={result.place_id}
                          type="button"
                          className="cm-focus flex w-full items-start justify-between gap-3 border border-border bg-surface p-3 text-left hover:bg-surface-secondary"
                          onClick={() => void selectPOI(result)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{result.name}</span>
                            <span className="mt-1 block truncate text-xs text-muted">{result.address ?? t("noAddress")}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[0.65rem] uppercase text-muted">Google</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

              {poi ? (
                <form className="space-y-5 border-t border-border pt-5" onSubmit={createCafe}>
                  <POIPreview poi={poi} name={name} onNameChange={setName} />
                  <div className="space-y-4">
                    <div className="rounded-md border border-border bg-surface p-4">
                      <Slider
                        value={overall ?? 50}
                        onChange={(value) => setOverall(Array.isArray(value) ? value[0] : value)}
                        minValue={0}
                        maxValue={100}
                        aria-label={t("overall")}
                      >
                        <div className="flex items-baseline justify-between">
                          <Label>{t("overall")}</Label>
                          <Slider.Output className="font-mono text-md font-medium text-accent" />
                        </div>
                        <Slider.Track>
                          <Slider.Fill />
                          <Slider.Thumb />
                        </Slider.Track>
                      </Slider>
                      {overall === null ? <p className="mt-2 text-xs text-muted">{t("scoreRequired")}</p> : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <PolicyChips
                        label={ts("minSpend")}
                        options={policyOptions(MIN_SPEND_VALUES, minSpendLabels) as Array<{ value: MinSpend; label: string }>}
                        selected={minSpend}
                        onSelect={setMinSpend}
                      />
                      <PolicyChips
                        label={ts("maxStay")}
                        options={policyOptions(MAX_STAY_VALUES, maxStayLabels) as Array<{ value: MaxStay; label: string }>}
                        selected={maxStay}
                        onSelect={setMaxStay}
                      />
                    </div>
                    <TextField className="w-full" isRequired>
                      <Label>{t("note")}</Label>
                      <TextArea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={t("notePlaceholder")}
                        rows={4}
                      />
                    </TextField>
                    <div className="space-y-2">
                      <Label>{t("photo")}</Label>
                      <label className="cm-focus flex cursor-pointer items-center justify-between gap-3 border border-dashed border-border bg-surface-secondary p-4 text-sm text-foreground hover:bg-surface-tertiary">
                        <span className="min-w-0 truncate">{photo?.name ?? t("photoPlaceholder")}</span>
                        <span className="shrink-0 text-xs text-accent">{t("choosePhoto")}</span>
                        <input className="sr-only" type="file" accept="image/*" onChange={handlePhoto} />
                      </label>
                      <p className="text-xs text-muted">{t("photoHint")}</p>
                    </div>
                  </div>
                  {duplicateCafeId ? (
                    <p className="text-sm text-warning" role="status">
                      {t("alreadyExists")} {duplicateCafeId ? <a className="text-link underline" href={`/cafes/${duplicateCafeId}`}>{t("viewCafe")}</a> : null}
                    </p>
                  ) : null}
                  {createdCafeId ? (
                    <p className="text-sm text-success" role="status">
                      {t("created")} <a className="text-link underline" href={`/cafes/${createdCafeId}`}>{t("viewCafe")}</a>
                    </p>
                  ) : null}
                  <Button type="submit" variant="primary" className="w-full" isDisabled={busy || Boolean(createdCafeId)}>
                    {busy ? <Spinner size="sm" /> : t("submit")}
                  </Button>
                </form>
              ) : null}
            </div>
          </Drawer.Body>
          <Drawer.Footer>
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
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!isAuthenticated) return null;
  return (
    <>
      <Button variant="primary" isDisabled={!isOnline} onPress={() => setIsOpen(true)}>
        {isOnline ? t("title") : t("offline")}
      </Button>
      <CafeCreationSheet isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}
