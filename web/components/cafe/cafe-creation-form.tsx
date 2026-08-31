"use client";

import {
  Button,
  Label,
  Slider,
  Spinner,
  TextArea,
  TextField,
} from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { PolicyChips, policyOptions } from "./policy-chips";
import { POIPreview } from "./poi-preview";
import { uploadPhoto } from "@/lib/images/client-upload";
import { responseMessage } from "@/lib/http";
import { MAX_STAY_VALUES, type MaxStay } from "@/types/checkins";
import type { POI } from "@shared/places/types";

interface CafeCreationFormProps {
  poi: POI;
  name: string;
  onNameChange: (name: string) => void;
  isAuthenticated: boolean;
  onError: (error: string | null) => void;
}

export function CafeCreationForm({
  poi,
  name,
  onNameChange,
  isAuthenticated,
  onError,
}: CafeCreationFormProps) {
  const t = useTranslations("create");
  const ts = useTranslations("search");

  const [overall, setOverall] = useState<number | null>(null);
  const [maxStay, setMaxStay] = useState<MaxStay>("unknown");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicateCafeId, setDuplicateCafeId] = useState<string | null>(null);
  const [createdCafeId, setCreatedCafeId] = useState<string | null>(null);
  const [showSignInGate, setShowSignInGate] = useState(false);

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    setPhoto(event.target.files?.[0] ?? null);
    onError(null);
  };

  const maxStayLabels = Object.fromEntries(
    MAX_STAY_VALUES.map((value) => [value, ts(`maxStayOptions.${value}`)]),
  ) as Record<string, string>;

  const createCafe = async (event: FormEvent) => {
    event.preventDefault();
    if (!navigator.onLine) {
      onError(t("offline"));
      return;
    }
    if (!poi || overall === null || !note.trim() || !photo || !name.trim()) {
      onError(t("requiredFields"));
      return;
    }
    if (!isAuthenticated) {
      onError(t("signInRequired"));
      setShowSignInGate(true);
      return;
    }
    setBusy(true);
    onError(null);
    setDuplicateCafeId(null);
    setShowSignInGate(false);
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
      onError(
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

  return (
    <>
      <form className="space-y-5 border-t border-border pt-5" onSubmit={createCafe}>
        <POIPreview poi={poi} name={name} onNameChange={onNameChange} />
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
          <PolicyChips
            label={ts("maxStay")}
            options={policyOptions(MAX_STAY_VALUES, maxStayLabels) as Array<{ value: MaxStay; label: string }>}
            selected={maxStay}
            onSelect={setMaxStay}
          />
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
            {t("alreadyExists")}
          </p>
        ) : null}
        {createdCafeId ? (
          <p className="text-sm text-success" role="status">
            {t("created")}
          </p>
        ) : null}
        <Button type="submit" variant="primary" className="w-full" isDisabled={busy || Boolean(createdCafeId)}>
          {busy ? <Spinner size="sm" /> : t("submit")}
        </Button>
      </form>
      {showSignInGate ? (
        <div className="space-y-3 border-t border-border pt-5">
          <p className="text-sm text-muted">{t("signInRequired")}</p>
          <div className="flex flex-col gap-2">
            <SignInButton provider="apple" variant="primary" />
            <SignInButton provider="google" variant="outline" />
          </div>
        </div>
      ) : null}
    </>
  );
}
