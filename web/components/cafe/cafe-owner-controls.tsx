"use client";

/**
 * Owner-only cafe lifecycle controls (DG146/DG147, BRAWUKA-31/515).
 *
 * Two render sites, both behind a server-computed ownership check:
 * - the SSR `/cafes/[id]` page (`created_by === viewer`, force-dynamic so
 *   per-user props never leak into the shared CDN shell cache, DG107);
 * - the in-app detail (`PublicCafeDetail.owned_by_viewer` — the API computes
 *   the bit before stripping `created_by`, DG13).
 *
 * - Visibility: reversible hide via PATCH /api/cafes/[id]/visibility. No
 *   confirm — the copy says it is reversible ("隐藏后仅你可见，可随时公开").
 * - Delete: checkin-scoped, never deletes the cafe row. The owner always
 *   confirms first (shell copy); a `cafe_has_other_checkins` envelope (409
 *   since spec 0011) upgrades the same confirm surface to the handoff copy
 *   and retries with `{ confirm: true }`. Machine codes never reach the UI
 *   (BRAWUKA-212).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Label, Switch, toast } from "@heroui/react";
import { DangerConfirm } from "@/components/danger-confirm";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { invalidateCheckinQueries } from "@/components/checkin/checkin-api";
import { apiFetch, ApiError, isUnauthorized } from "@/lib/http";
import type { CafeVisibility } from "@/types/cafes";

type DeleteStep = "idle" | "confirm" | "handoff";

function VisibilityRow({
  isPrivate,
  pending,
  onToggle,
}: {
  isPrivate: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  const t = useTranslations("cafeDetail");
  return (
    <Switch
      isSelected={isPrivate}
      onChange={onToggle}
      isDisabled={pending}
      className="w-full"
    >
      <Switch.Content className="w-full justify-between">
        <span className="flex min-w-0 flex-col gap-0.5">
          <Label className="text-sm font-medium text-foreground">
            {t("visibility_label")}
          </Label>
          <span className="text-xs font-normal text-muted">
            {t("visibility_hint")}
          </span>
        </span>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

function DeleteConfirmBox({
  step,
  otherCheckins,
  pending,
  onCancel,
  onConfirm,
}: {
  step: Exclude<DeleteStep, "idle">;
  otherCheckins: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("cafeDetail");
  return (
    <DangerConfirm
      message={
        step === "handoff"
          ? t("delete_handoff_body", { n: otherCheckins })
          : t("delete_confirm_body")
      }
      confirmLabel={step === "handoff" ? t("delete_mine") : t("delete")}
      cancelLabel={t("cancel")}
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function DeleteSection({
  cafeId,
  onRequireSignIn,
}: {
  cafeId: string;
  onRequireSignIn: () => void;
}) {
  const t = useTranslations("cafeDetail");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<DeleteStep>("idle");
  const [otherCheckins, setOtherCheckins] = useState(0);
  const [pending, setPending] = useState(false);

  async function confirmDelete() {
    if (pending) return;
    setPending(true);
    try {
      // DG146 contract: the first DELETE goes out UNCONFIRMED — only a bare
      // request can surface `cafe_has_other_checkins` (the API never throws
      // it once confirm:true is set). The handoff retry below is the only
      // call that carries { confirm: true }.
      await apiFetch(`/api/cafes/${cafeId}`, {
        method: "DELETE",
        ...(step === "handoff"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirm: true }),
            }
          : {}),
      });
      // The cafe drops out of "我的咖啡地图" server-side; refresh the local
      // view (feed empties, stats recompute, owner controls unmount).
      invalidateCheckinQueries(queryClient, cafeId);
      queryClient.invalidateQueries({ queryKey: ["cafes-list"] });
      toast(t("delete_done"), { timeout: 3000 });
      setStep("idle");
      router.refresh();
    } catch (cause) {
      // The conflict code is the contract, not the status — it moved
      // 403 → 409 under spec 0011 and consumers must not care.
      if (cause instanceof ApiError && cause.code === "cafe_has_other_checkins") {
        const n = cause.details?.n;
        setOtherCheckins(typeof n === "number" ? n : 0);
        setStep("handoff");
        return;
      }
      if (isUnauthorized(cause)) {
        onRequireSignIn();
        return;
      }
      setStep("idle");
      toast(t("delete_failed"), { timeout: 4000 });
    } finally {
      setPending(false);
    }
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("confirm")}
        className="-my-2.5 inline-flex min-h-11 items-center self-start text-sm text-danger hover:underline"
      >
        {t("delete_cafe")}
      </button>
    );
  }

  return (
    <DeleteConfirmBox
      step={step}
      otherCheckins={otherCheckins}
      pending={pending}
      onCancel={() => setStep("idle")}
      onConfirm={() => void confirmDelete()}
    />
  );
}

export function CafeOwnerControls({
  cafeId,
  initialVisibility,
  hasCheckins,
}: {
  cafeId: string;
  initialVisibility: CafeVisibility;
  /** False on an empty shell — the owner has no live checkins left to delete. */
  hasCheckins: boolean;
}) {
  const t = useTranslations("cafeDetail");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<CafeVisibility>(initialVisibility);
  const [pending, setPending] = useState(false);
  // A 401 on either owner write means the session died under a mounted
  // surface — swap the controls for the shared gate (BRAWUKA-540).
  const [sessionExpired, setSessionExpired] = useState(false);

  async function toggleVisibility(next: boolean) {
    if (pending) return;
    const previous = visibility;
    const target: CafeVisibility = next ? "private" : "public";
    setVisibility(target); // reversible toggle: optimistic, rollback on failure
    setPending(true);
    try {
      await apiFetch(`/api/cafes/${cafeId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: target }),
      });
      queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["cafes-list"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      // The "仅你可见" badge is SSR — refresh so it tracks the new state.
      router.refresh();
    } catch (cause) {
      setVisibility(previous);
      if (isUnauthorized(cause)) {
        setSessionExpired(true);
        return;
      }
      toast(t("visibility_failed"), { timeout: 4000 });
    } finally {
      setPending(false);
    }
  }

  if (sessionExpired) {
    return (
      <section
        aria-label={t("owner_controls_aria")}
        className="flex flex-col gap-3 border-t border-separator pt-4"
      >
        <SignInGate message={t("sign_in_gate")} next={`/cafes/${cafeId}`} />
      </section>
    );
  }

  return (
    <section
      aria-label={t("owner_controls_aria")}
      className="flex flex-col gap-3 border-t border-separator pt-4"
    >
      <VisibilityRow
        isPrivate={visibility === "private"}
        pending={pending}
        onToggle={(next) => void toggleVisibility(next)}
      />
      {hasCheckins && (
        <DeleteSection cafeId={cafeId} onRequireSignIn={() => setSessionExpired(true)} />
      )}
    </section>
  );
}
