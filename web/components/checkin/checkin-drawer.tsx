"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Drawer, toast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckinSlider } from "./checkin-slider";
import { CheckinPhotos, type PhotoUpload } from "./checkin-photos";
import { CheckinSuccess } from "./checkin-success";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { SignInButton } from "@/components/auth/sign-in-button";
import { responseMessage } from "@/lib/http";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import { MAX_STAY_VALUES } from "@/types/checkins";

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

async function fetchLastCheckin(cafeId: string) {
  const res = await fetch(`/api/checkins/last?cafe_id=${encodeURIComponent(cafeId)}`);
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("failed");
  const body = (await res.json()) as {
    checkin: { id: string; scores: CheckInScores; max_stay: MaxStay | null; note: string | null; visited_at: string } | null;
  };
  return body.checkin;
}

function CheckinForm({
  cafeId,
  cafeName,
  mode,
  editCheckinId,
  initialScores,
  initialMaxStay,
  initialNote,
  isAuthenticated,
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
  /** Server-known auth state; undefined = resolve client-side (cached public shell). */
  isAuthenticated?: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("checkIn");
  const ts = useTranslations("search");
  const queryClient = useQueryClient();
  const { state: networkState } = useNetworkStatus();
  const isOffline = networkState === "offline";

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
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const [view, setView] = useState<ViewState>("form");
  const [error, setError] = useState<string | null>(null);
  const [showSignInGate, setShowSignInGate] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const [failedAction, setFailedAction] = useState<"save" | "delete" | null>(null);

  const lastCheckinQuery = useQuery({
    queryKey: ["last-checkin", cafeId],
    queryFn: () => fetchLastCheckin(cafeId),
    enabled: !isEdit && isAuthenticated !== false,
    staleTime: 60_000,
    retry: false,
  });

  const authProbeFailed =
    lastCheckinQuery.isError &&
    lastCheckinQuery.error instanceof Error &&
    lastCheckinQuery.error.message === "unauthorized";
  const effectivelyAuthenticated = (isAuthenticated ?? true) && !authProbeFailed;

  const lastCheckin = lastCheckinQuery.data;
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

      const uploadedIds = photos.filter((p) => p.status === "done" && p.imageUuid).map((p) => p.imageUuid!);
      const hasUploading = photos.some((p) => p.status === "uploading");
      if (hasUploading) throw new Error("photos_uploading");

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
        setShowSignInGate(true);
        return;
      }
      setFailedAction("save");
      if (err instanceof Error && err.message === "photos_uploading") {
        setError(t("photosUploading"));
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
                <CheckinPhotos photos={photos} onChange={setPhotos} maxPhotos={6} />
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
                  <SignInButton provider="google" variant="primary" />
                  <SignInButton provider="apple" variant="outline" />
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
  isAuthenticated,
}: CheckinDrawerProps) {
  const t = useTranslations("checkIn");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const dirtyRef = useRef(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const formKey = isOpen ? `${cafeId}-${mode}-${editCheckinId ?? "new"}` : "closed";

  const handleCloseAttempt = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        if (dirtyRef.current) {
          setShowDiscardConfirm(true);
          return;
        }
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <Drawer.Root isOpen={isOpen} onOpenChange={handleCloseAttempt}>
      <Drawer.Backdrop />
      <Drawer.Content placement="bottom" className="max-h-[92dvh] bg-overlay text-foreground">
        <Drawer.Dialog aria-label={mode === "edit" ? t("editTitle") : t("title")} className="flex max-h-[92dvh] flex-col">
          {isOpen && (
            <CheckinForm
              key={formKey}
              cafeId={cafeId}
              cafeName={cafeName}
              mode={mode}
              editCheckinId={editCheckinId}
              initialScores={initialScores}
              initialMaxStay={initialMaxStay}
              initialNote={initialNote}
              isAuthenticated={isAuthenticated}
              onClose={() => onOpenChange(false)}
              onDirtyChange={handleDirtyChange}
            />
          )}

          {showDiscardConfirm && (
            <div className="absolute inset-0 flex items-end justify-center bg-black/30 p-4">
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
