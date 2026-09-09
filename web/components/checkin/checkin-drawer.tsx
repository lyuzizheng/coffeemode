"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Drawer, toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckinSlider } from "./checkin-slider";
import { CheckinPhotos, type PhotoUpload } from "./checkin-photos";
import { CheckinSuccess } from "./checkin-success";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { SignInButton } from "@/components/auth/sign-in-button";
import { responseMessage } from "@/lib/http";
import { uploadPhoto } from "@/lib/images/client-upload";
import { clearPendingCheckin, savePendingCheckin } from "@/lib/checkin/pending-checkin";
import { fetchLastCheckin, type LastCheckin } from "@/lib/checkin/last-checkin";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import { MAX_STAY_VALUES } from "@/types/checkins";

/** Query flag the OAuth callback round-trip carries so CheckinResume knows
    to reload the pending draft and reopen the drawer (DG66). */
export const CHECKIN_RESUME_PARAM = "checkin_resume";

type DrawerMode = "create" | "edit";
type ViewState = "form" | "success" | "submitting";

interface CheckinDrawerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  cafeId: string;
  cafeName: string;
  mode?: DrawerMode;
  editCheckinId?: string;
  initialScores?: CheckInScores;
  initialMaxStay?: MaxStay | null;
  initialNote?: string | null;
  /** Restored sign-in gate draft photos (DG66) — staged entries re-upload at publish. */
  initialPhotos?: PhotoUpload[];
  isAuthenticated?: boolean;
}

function formatLastVisit(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

function isWithin90Days(iso: string): boolean {
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs < 90 * 24 * 60 * 60 * 1000;
}

/**
 * DG61 idempotency key: one UUID v4 per drawer open, sent with the create
 * and reused by every retry of that open — a retry after a flaky connection
 * can never double-record. crypto.randomUUID is universal in supported
 * browsers; the Math.random fallback keeps the v4 shape so older WebViews
 * still validate server-side (uniqueness is time+entropy seeded and the key
 * is scoped per user, so collision risk is nil).
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const nibble = () => Math.floor(Math.random() * 16).toString(16);
  const hex = (n: number) => Array.from({ length: n }, nibble).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((parseInt(nibble(), 16) & 0x3) | 0x8).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * DG64 same-day-revisit switch: returns the last check-in when it falls
 * inside the server-provided revisit window (at most 1 per cafe per user
 * per window — a further visit edits this check-in), else null. A missing
 * window means "unknown": no preempt, the POST 409 fallback still converts
 * silently, so the user never sees a conflict either way.
 */
export function resolveRevisitCheckin(
  data: { checkin: LastCheckin | null; revisitWindowHours?: number } | undefined,
  now: number = Date.now(),
): LastCheckin | null {
  const checkin = data?.checkin;
  const windowHours = data?.revisitWindowHours;
  if (!checkin || typeof windowHours !== "number" || !(windowHours > 0)) return null;
  const ageMs = now - new Date(checkin.visited_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs >= windowHours * 3_600_000) return null;
  return checkin;
}

function CheckinForm({
  cafeId,
  cafeName,
  mode,
  editCheckinId,
  initialScores,
  initialMaxStay,
  initialNote,
  initialPhotos,
  isAuthenticated,
  lastCheckin,
  authProbeFailed,
  lastCheckinLoaded,
  onClose,
  onDirtyChange,
}: {
  cafeId: string;
  cafeName: string;
  mode: DrawerMode;
  editCheckinId?: string;
  initialScores?: CheckInScores;
  initialMaxStay?: MaxStay | null;
  initialNote?: string | null;
  initialPhotos?: PhotoUpload[];
  /** Server-known auth state; undefined = resolve client-side (cached public shell). */
  isAuthenticated?: boolean;
  /** Last check-in probe result, owned by CheckinDrawer (shared query). */
  lastCheckin?: LastCheckin | null;
  /** True when the probe 401d: anonymous on the cached public shell. */
  authProbeFailed?: boolean;
  /** True when the drawer-owned probe completed successfully (DG59 upload gating). */
  lastCheckinLoaded?: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("checkIn");
  const ts = useTranslations("search");
  const queryClient = useQueryClient();
  const { state: networkState } = useNetworkStatus();
  const isOffline = networkState === "offline";

  // OAuth returns to this page flagged so CheckinResume reloads the draft.
  // The gate only renders after user interaction, but keep the read
  // SSR-safe — this form never mounts on the server in practice.
  const resumePath =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}?${CHECKIN_RESUME_PARAM}=1`;

  const isEdit = mode === "edit";
  // Auth is resolved server-side where the page knows it (home, profile) via the
  // `isAuthenticated` prop. On the CDN-cached public cafe shell (DG105/DG106) the
  // prop is undefined and auth is resolved here client-side: the last-check-in
  // probe 401s for anonymous users, and a 401 from submit/delete drops to the
  // sign-in gate instead of a raw error.

  const [wifi, setWifi] = useState<number | null>(initialScores?.wifi ?? null);
  const [outlets, setOutlets] = useState<number | null>(initialScores?.outlets ?? null);
  const [seats, setSeats] = useState<number | null>(initialScores?.seats ?? null);
  const [temp, setTemp] = useState<number | null>(initialScores?.temp ?? null);
  const [coffee, setCoffee] = useState<number | null>(initialScores?.coffee ?? null);
  const [overall, setOverall] = useState<number | null>(initialScores?.overall ?? null);
  const [maxStay, setMaxStay] = useState<MaxStay | null>(initialMaxStay ?? null);
  const [note, setNote] = useState(initialNote ?? "");
  const [photos, setPhotos] = useState<PhotoUpload[]>(initialPhotos ?? []);
  const [view, setView] = useState<ViewState>("form");
  const [error, setError] = useState<string | null>(null);
  const [showSignInGate, setShowSignInGate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const [failedAction, setFailedAction] = useState<"save" | "delete" | null>(null);
  // DG61: one idempotency key per drawer open. useState lazy init pins it
  // for the life of this form instance — every inline retry of a failed
  // submit reuses it — while a reopen remounts the form (formKey) and mints
  // a fresh one. Edit submits never send it (PATCH targets a known id).
  const [idempotencyKey] = useState(newIdempotencyKey);
  // Auth is resolved server-side where the page knows it (home, profile) via the
  // `isAuthenticated` prop. On the CDN-cached public cafe shell (DG105/DG106) the
  // prop is undefined and auth is resolved client-side: the drawer-owned
  // last-check-in probe 401s for anonymous users, and a 401 from
  // submit/delete drops to the sign-in gate instead of a raw error.
  const effectivelyAuthenticated = (isAuthenticated ?? true) && !authProbeFailed;

  // Photos upload on selection only once auth is positively known (DG59):
  // server-known pages pass the prop, the cached shell waits for its probe.
  // Until then selections are staged locally and upload at publish time.
  const authConfirmed =
    isAuthenticated === true || (isAuthenticated === undefined && lastCheckinLoaded);
  const deferUpload = !isEdit && !authConfirmed;

  /** Persist the in-progress draft before the full-page OAuth bounce (DG66). */
  const stagePendingDraft = useCallback(() => {
    if (isEdit) return;
    // Best-effort: a blocked IndexedDB (private mode) must not break the gate.
    void savePendingCheckin({
      cafeId,
      cafeName,
      scores: {
        ...(wifi !== null ? { wifi } : {}),
        ...(outlets !== null ? { outlets } : {}),
        ...(seats !== null ? { seats } : {}),
        ...(temp !== null ? { temp } : {}),
        ...(coffee !== null ? { coffee } : {}),
        ...(overall !== null ? { overall } : {}),
      },
      maxStay,
      note,
      photos: photos
        .filter((p) => p.file)
        .map((p) => ({ id: p.id, file: p.file!, ...(p.imageUuid ? { imageUuid: p.imageUuid } : {}) })),
      createdAt: Date.now(),
    }).catch(() => {});
  }, [isEdit, cafeId, cafeName, wifi, outlets, seats, temp, coffee, overall, maxStay, note, photos]);

  // The gate renders inline — every field above it stays editable while it
  // is visible. Gate visibility drives draft staging (stagePendingDraft's
  // identity tracks all draft fields), so the bounce always restores the
  // latest input, not the gate-trigger snapshot (DG66 "no re-entry").
  useEffect(() => {
    if (showSignInGate) stagePendingDraft();
  }, [showSignInGate, stagePendingDraft]);
  const lastVisitWithin90Days = useMemo(() => {
    if (!lastCheckin) return false;
    return isWithin90Days(lastCheckin.visited_at);
  }, [lastCheckin]);

  const showRepeatBanner = !isEdit && lastVisitWithin90Days && !repeatDismissed && Boolean(lastCheckin);

  const applySameAsLast = useCallback(() => {
    if (!lastCheckin) return;
    setWifi(lastCheckin.scores.wifi ?? null);
    setOutlets(lastCheckin.scores.outlets ?? null);
    setSeats(lastCheckin.scores.seats ?? null);
    setTemp(lastCheckin.scores.temp ?? null);
    setCoffee(lastCheckin.scores.coffee ?? null);
    setOverall(lastCheckin.scores.overall ?? null);
    setMaxStay(lastCheckin.max_stay ?? null);
    setNote(lastCheckin.note ?? "");
    setRepeatDismissed(true);
  }, [lastCheckin]);

  const isDirty = useMemo(() => {
    if (isEdit) {
      const base = initialScores ?? {};
      return (
        wifi !== (base.wifi ?? null) ||
        outlets !== (base.outlets ?? null) ||
        seats !== (base.seats ?? null) ||
        temp !== (base.temp ?? null) ||
        coffee !== (base.coffee ?? null) ||
        overall !== (base.overall ?? null) ||
        maxStay !== (initialMaxStay ?? null) ||
        note !== (initialNote ?? "") ||
        photos.length > 0
      );
    }
    return (
      wifi !== null ||
      outlets !== null ||
      seats !== null ||
      temp !== null ||
      coffee !== null ||
      overall !== null ||
      maxStay !== null ||
      note.trim() !== "" ||
      photos.length > 0
    );
  }, [isEdit, wifi, outlets, seats, temp, coffee, overall, maxStay, note, photos, initialScores, initialMaxStay, initialNote]);

  // Report dirty state up so the drawer's close guard doesn't scrape the DOM.
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  const canSubmit = overall !== null && view !== "submitting" && view !== "success";

  const submitMutation = useMutation({
    mutationFn: async () => {
      const scores: CheckInScores = {};
      if (wifi !== null) scores.wifi = wifi;
      if (outlets !== null) scores.outlets = outlets;
      if (seats !== null) scores.seats = seats;
      if (temp !== null) scores.temp = temp;
      if (coffee !== null) scores.coffee = coffee;
      if (overall !== null) scores.overall = overall;

      const hasUploading = photos.some((p) => p.status === "uploading");
      if (hasUploading) throw new Error("photos_uploading");

      // Staged photos (logged-out composer, DG59) upload now, at publish
      // time — presigned URLs are issued to authenticated sessions only.
      // Previously failed tiles still hold their File and retry here too.
      const pendingUploads = photos.filter((p) => p.file && !p.imageUuid);
      const justUploaded = new Map<string, string>();
      if (pendingUploads.length > 0) {
        const failedIds = new Set<string>();
        await Promise.all(
          pendingUploads.map(async (p) => {
            try {
              justUploaded.set(p.id, await uploadPhoto(p.file!));
            } catch {
              failedIds.add(p.id);
            }
          }),
        );
        // Write every successful upload back into state before anything can
        // fail: a retry (failed photos or a failed POST) must reuse these
        // ids, not re-upload and orphan the first batch in R2.
        setPhotos((prev) =>
          prev.map((p) => {
            const uuid = justUploaded.get(p.id);
            if (uuid) return { ...p, status: "done", imageUuid: uuid };
            if (failedIds.has(p.id)) return { ...p, status: "error" as const };
            return p;
          }),
        );
        if (failedIds.size > 0) {
          throw new Error("photo_upload_failed");
        }
      }
      const uploadedIds = photos
        .map((p) => p.imageUuid ?? justUploaded.get(p.id))
        .filter((id): id is string => Boolean(id));

      if (isEdit && editCheckinId) {
        const body: Record<string, unknown> = { scores, max_stay: maxStay, note: note.trim() ? note.trim() : null };
        const res = await fetch(`/api/checkins/${editCheckinId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) throw new Error("unauthorized");
        if (!res.ok) throw new Error(await responseMessage(res, t("couldntSave")));
        return res.json();
      }
      const body: Record<string, unknown> = {
        cafe_id: cafeId,
        // DG61: same key on every retry of this open; the server dedupes.
        idempotency_key: idempotencyKey,
        scores,
        ...(maxStay ? { max_stay: maxStay } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(uploadedIds.length > 0 ? { photo_ids: uploadedIds } : {}),
      };
      const res = await fetch("/api/checkins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) throw new Error("unauthorized");
      if (res.status === 409) {
        // Lost a race after the probe (second tab, or input typed before the
        // probe resolved): DG64 is product behavior, never a user-facing
        // error — convert to an edit of the existing check-in silently.
        const conflict = (await res.json().catch(() => null)) as {
          existing_checkin_id?: unknown;
        } | null;
        const existingId = conflict?.existing_checkin_id;
        if (typeof existingId === "string" && existingId.length > 0) {
          const patchBody: Record<string, unknown> = {
            scores,
            max_stay: maxStay,
            note: note.trim() ? note.trim() : null,
          };
          const retry = await fetch(`/api/checkins/${existingId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patchBody),
          });
          if (retry.status === 401) throw new Error("unauthorized");
          if (!retry.ok) throw new Error(await responseMessage(retry, t("couldntSave")));
          return retry.json();
        }
      }
      if (!res.ok) throw new Error(await responseMessage(res, t("couldntSave")));
      return res.json();
    },
    onMutate: () => {
      setView("submitting");
      setError(null);
      setFailedAction(null);
    },
    onSuccess: () => {
      setView("success");
      // The pending gate draft (DG66) has been published — drop it.
      void clearPendingCheckin().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["last-checkin", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setTimeout(() => {
        onClose();
        toast(t("saved"), { timeout: 3000 });
      }, 1200);
    },
    onError: (err) => {
      setView("form");
      if (err instanceof Error && err.message === "unauthorized") {
        // Session expired mid-compose (the probe raced it): showing the gate
        // stages the draft, so the OAuth bounce still restores everything.
        setShowSignInGate(true);
        return;
      }
      setFailedAction("save");
      if (err instanceof Error && err.message === "photos_uploading") {
        setError(t("photosUploading"));
      } else if (err instanceof Error && err.message === "photo_upload_failed") {
        setError(t("photosFailed"));
      } else {
        setError(err instanceof Error ? err.message : t("couldntSave"));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editCheckinId) throw new Error("missing id");
      const res = await fetch(`/api/checkins/${editCheckinId}`, { method: "DELETE" });
      if (res.status === 401) throw new Error("unauthorized");
      if (!res.ok) throw new Error(await responseMessage(res, t("couldntSave")));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["cafe-checkins", cafeId] });
      // The DG72 cafe-page "Edit your check-in" row keys off this probe —
      // without it the row would linger after the last live check-in is gone.
      queryClient.invalidateQueries({ queryKey: ["last-checkin", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      onClose();
      toast(t("deleted"), { timeout: 3000 });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "unauthorized") {
        setShowSignInGate(true);
        return;
      }
      setFailedAction("delete");
      setError(err instanceof Error ? err.message : t("couldntSave"));
    },
  });

  const handleSubmit = () => {
    if (isOffline) {
      setError(t("offline"));
      return;
    }
    if (overall === null) return;
    if (!effectivelyAuthenticated) {
      // DG66: showing the gate stages every input (and re-stages on further
      // edits), so the OAuth bounce restores it all — no re-entry.
      setShowSignInGate(true);
      return;
    }
    submitMutation.mutate();
  };

  const maxStayLabels = Object.fromEntries(
    MAX_STAY_VALUES.map((v) => [v, ts(`maxStayOptions.${v}`)]),
  ) as Record<string, string>;

  return (
    <div className="flex flex-1 flex-col">
      <Drawer.Header className="shrink-0 border-b border-separator px-4 py-3">
        <Drawer.Heading className="truncate font-display text-lg">{cafeName}</Drawer.Heading>
        <Drawer.CloseTrigger className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-secondary">
          <span aria-hidden className="text-xl leading-none">×</span>
          <span className="sr-only">{t("close")}</span>
        </Drawer.CloseTrigger>
        {!isEdit && <p className="mt-1 text-xs text-muted">{t("promptCaption")}</p>}
      </Drawer.Header>

      <Drawer.Body className="flex-1 overflow-y-auto px-4 py-4">
        {view === "success" ? (
          <CheckinSuccess cafeName={cafeName} />
        ) : (
          <div className="flex flex-col gap-4">
            {showRepeatBanner && lastCheckin && (
              <div className="flex items-center justify-between rounded-md bg-surface-secondary p-3">
                <span className="text-sm">{t("lastVisit", { date: formatLastVisit(lastCheckin.visited_at) })}</span>
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onPress={applySameAsLast} className="h-7 rounded-sm px-3 text-xs">
                    {t("same")}
                  </Button>
                  <Button variant="ghost" size="sm" onPress={() => setRepeatDismissed(true)} className="h-7 rounded-sm px-3 text-xs">
                    {t("new")}
                  </Button>
                  <button type="button" onClick={() => setRepeatDismissed(true)} className="ml-1 text-muted hover:text-foreground" aria-label={t("dismiss")}>
                    ×
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <CheckinSlider label={t("wifi")} value={wifi} onChange={setWifi} showClear={isEdit} onClear={() => setWifi(null)} />
              <CheckinSlider label={t("outlets")} value={outlets} onChange={setOutlets} showClear={isEdit} onClear={() => setOutlets(null)} />
              <CheckinSlider label={t("seats")} value={seats} onChange={setSeats} showClear={isEdit} onClear={() => setSeats(null)} />
              <CheckinSlider label={t("temp")} value={temp} onChange={setTemp} variant="temperature" showClear={isEdit} onClear={() => setTemp(null)} />
              <CheckinSlider label={t("coffee")} value={coffee} onChange={setCoffee} showClear={isEdit} onClear={() => setCoffee(null)} />

              <div className="border-t border-separator pt-3">
                <CheckinSlider label={t("overallExperience")} value={overall} onChange={setOverall} showClear={isEdit} onClear={() => setOverall(null)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t("maxStay")}</div>
              <div className="flex flex-wrap gap-2">
                {MAX_STAY_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={maxStay === value}
                    onClick={() => setMaxStay(maxStay === value ? null : value)}
                    className={`h-9 rounded-sm border px-3 text-xs font-medium transition-colors ${
                      maxStay === value
                        ? "border-accent bg-surface text-accent"
                        : "border-border bg-surface-secondary text-foreground hover:bg-surface-tertiary"
                    }`}
                  >
                    {maxStayLabels[value] ?? value}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted">{t("noteOptional")}</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder={t("notePlaceholder")}
                rows={3}
                className="min-h-[72px] w-full resize-none rounded-md border border-border bg-surface p-3 text-base placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                maxLength={500}
              />
            </div>

            {!isEdit && (
              <div className="space-y-1">
                <div className="text-xs text-muted">{t("photos")}</div>
                <CheckinPhotos photos={photos} onChange={setPhotos} maxPhotos={6} deferUpload={deferUpload} />
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <span>{error}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => (failedAction === "delete" ? deleteMutation.mutate() : submitMutation.mutate())}
                  className="ml-auto h-7 text-xs"
                >
                  {t("retry")}
                </Button>
              </div>
            )}

            {showSignInGate && (
              <div className="rounded-md border border-separator bg-surface-secondary p-4 text-center">
                <p className="mb-3 text-sm">{t("signInGate")}</p>
                <div className="flex flex-col gap-2">
                  <SignInButton provider="google" variant="primary" next={resumePath} />
                  <SignInButton provider="apple" variant="outline" next={resumePath} />
                </div>
              </div>
            )}

            {isEdit && (
              <div className="border-t border-separator pt-4">
                {!showDeleteConfirm ? (
                  <button type="button" onClick={() => setShowDeleteConfirm(true)} className="text-sm text-danger hover:underline">
                    {t("deleteCheckin")}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-3">
                    <span className="text-sm">{t("deleteConfirm")}</span>
                    <Button variant="ghost" size="sm" onPress={() => setShowDeleteConfirm(false)} className="ml-auto h-7 text-xs">
                      {t("cancel")}
                    </Button>
                    <Button variant="primary" size="sm" onPress={() => deleteMutation.mutate()} className="h-7 bg-danger text-white hover:bg-danger/90 text-xs">
                      {t("delete")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer.Body>

      {view !== "success" && (
        <Drawer.Footer className="shrink-0 border-t border-separator bg-surface p-4">
          <Button
            variant="primary"
            className="w-full h-12 rounded-sm text-base font-medium"
            isDisabled={!canSubmit || isOffline}
            onPress={handleSubmit}
          >
            {view === "submitting" ? t("saving") : isEdit ? t("saveChanges") : t("submit")}
          </Button>
          {!canSubmit && overall === null && view === "form" && (
            <p className="mt-2 text-center text-xs text-muted">{t("overallHint")}</p>
          )}
          {isOffline && <p className="mt-2 text-center text-xs text-muted">{t("offline")}</p>}
        </Drawer.Footer>
      )}
    </div>
  );
}

export function CheckinDrawer({
  isOpen,
  onOpenChange,
  cafeId,
  cafeName,
  mode = "create",
  editCheckinId,
  initialScores,
  initialMaxStay,
  initialNote,
  initialPhotos,
  isAuthenticated,
}: CheckinDrawerProps) {
  const t = useTranslations("checkIn");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  // DG64 same-day-revisit probe (shared with the form below via props — one
  // query key, one network call). Runs for create opens only; explicit edit
  // opens already know their check-in.
  const lastCheckinQuery = useQuery({
    queryKey: ["last-checkin", cafeId],
    queryFn: () => fetchLastCheckin(cafeId),
    enabled: isOpen && mode !== "edit" && isAuthenticated !== false,
    staleTime: 60_000,
    retry: false,
  });
  const authProbeFailed =
    lastCheckinQuery.isError &&
    lastCheckinQuery.error instanceof Error &&
    lastCheckinQuery.error.message === "unauthorized";

  // Preempt create → edit while the draft is still pristine, latched per open
  // (a dirty draft keeps its input — the POST 409 fallback still converts
  // silently — so a slow probe never wipes what the user already typed, and
  // later keystrokes can never flip the mode back under the form).
  const [preempted, setPreempted] = useState<LastCheckin | null>(null);
  const [preemptScope, setPreemptScope] = useState<string | null>(null);
  const scope = isOpen ? `${cafeId}|${mode}` : null;
  if (scope !== preemptScope) {
    setPreemptScope(scope);
    setPreempted(null);
  }
  const revisit = mode === "create" ? resolveRevisitCheckin(lastCheckinQuery.data) : null;
  if (!preempted && revisit && !isDirty) {
    setPreempted(revisit);
  }
  const preempt = preempted ?? (revisit && !isDirty ? revisit : null);
  const effectiveMode: DrawerMode = preempt ? "edit" : mode;
  const effectiveEditId = mode === "edit" ? editCheckinId : preempt?.id;

  const formKey = isOpen ? `${cafeId}-${effectiveMode}-${effectiveEditId ?? "new"}` : "closed";

  const handleCloseAttempt = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        if (isDirty) {
          setShowDiscardConfirm(true);
          return;
        }
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, isDirty],
  );

  return (
    <Drawer.Root isOpen={isOpen} onOpenChange={handleCloseAttempt}>
      <Drawer.Backdrop />
      <Drawer.Content placement="bottom" className="max-h-[92dvh] bg-overlay text-foreground">
        <Drawer.Dialog aria-label={effectiveMode === "edit" ? t("editTitle") : t("title")} className="flex max-h-[92dvh] flex-col">
          {isOpen && (
            <CheckinForm
              key={formKey}
              cafeId={cafeId}
              cafeName={cafeName}
              mode={effectiveMode}
              editCheckinId={effectiveEditId}
              initialScores={initialScores ?? revisit?.scores}
              initialMaxStay={initialMaxStay ?? revisit?.max_stay ?? null}
              initialNote={initialNote ?? revisit?.note ?? null}
              initialPhotos={initialPhotos}
              isAuthenticated={isAuthenticated}
              lastCheckin={lastCheckinQuery.data?.checkin ?? null}
              authProbeFailed={authProbeFailed}
              lastCheckinLoaded={lastCheckinQuery.isSuccess}
              onClose={() => onOpenChange(false)}
              onDirtyChange={handleDirtyChange}
            />
          )}

          {showDiscardConfirm && (
            <div className="absolute inset-0 flex items-end justify-center bg-scrim/30 p-4">
              <div className="w-full max-w-sm rounded-lg bg-surface p-4 shadow-lg">
                <p className="mb-4 text-sm font-medium">{t("discardTitle")}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onPress={() => setShowDiscardConfirm(false)}>
                    {t("keepEditing")}
                  </Button>
                  <Button
                    variant="primary"
                    className="bg-danger text-white hover:bg-danger/90"
                    onPress={() => {
                      setShowDiscardConfirm(false);
                      onOpenChange(false);
                    }}
                  >
                    {t("discard")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Root>
  );
}
