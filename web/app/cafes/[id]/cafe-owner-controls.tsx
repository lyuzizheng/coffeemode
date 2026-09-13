"use client";

/**
 * Owner-only cafe lifecycle controls (DG146/DG147, BRAWUKA-31).
 *
 * Rendered only when the server has already verified `created_by === viewer`
 * — the SSR page is force-dynamic and signed-in requests bypass the CDN shell
 * cache (DG107), so per-user props here never leak into the shared cache.
 *
 * - Visibility: reversible hide via PATCH /api/cafes/[id]/visibility. No
 *   confirm — the copy says it is reversible ("隐藏后仅你可见，可随时公开").
 * - Delete: checkin-scoped, never deletes the cafe row. The owner always
 *   confirms first (shell copy); a 403 `cafe_has_other_checkins` upgrades the
 *   same confirm surface to the handoff copy and retries with
 *   `{ confirm: true }`. Machine codes never reach the UI (BRAWUKA-212).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Label, Switch, toast } from "@heroui/react";
import { invalidateCheckinQueries } from "@/components/checkin/checkin-api";
import type { CafeVisibility } from "@/types/cafes";

type DeleteStep = "idle" | "confirm" | "handoff";

interface DeleteErrorBody {
  error?: string;
  code?: string;
  n?: number;
}

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
    <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 p-3">
      <p className="text-sm text-foreground">
        {step === "handoff"
          ? t("delete_handoff_body", { n: otherCheckins })
          : t("delete_confirm_body")}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          isDisabled={pending}
          className="-my-1 text-xs"
        >
          {t("cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={onConfirm}
          isDisabled={pending}
          className="-my-1 bg-danger-solid text-xs text-white hover:bg-danger-solid/90"
        >
          {step === "handoff" ? t("delete_mine") : t("delete")}
        </Button>
      </div>
    </div>
  );
}

function DeleteSection({ cafeId }: { cafeId: string }) {
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
      const res = await fetch(`/api/cafes/${cafeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (res.ok) {
        // The cafe drops out of "我的咖啡地图" server-side; refresh the local
        // view (feed empties, stats recompute, owner controls unmount).
        invalidateCheckinQueries(queryClient, cafeId);
        queryClient.invalidateQueries({ queryKey: ["cafes-list"] });
        toast(t("delete_done"), { timeout: 3000 });
        setStep("idle");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as DeleteErrorBody | null;
      if (res.status === 403 && body?.code === "cafe_has_other_checkins") {
        setOtherCheckins(typeof body.n === "number" ? body.n : 0);
        setStep("handoff");
        return;
      }
      setStep("idle");
      toast(t("delete_failed"), { timeout: 4000 });
    } catch {
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

  async function toggleVisibility(next: boolean) {
    if (pending) return;
    const previous = visibility;
    const target: CafeVisibility = next ? "private" : "public";
    setVisibility(target); // reversible toggle: optimistic, rollback on failure
    setPending(true);
    try {
      const res = await fetch(`/api/cafes/${cafeId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: target }),
      });
      if (!res.ok) {
        setVisibility(previous);
        toast(t("visibility_failed"), { timeout: 4000 });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["cafe", cafeId] });
      queryClient.invalidateQueries({ queryKey: ["cafes-list"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      // The "仅你可见" badge is SSR — refresh so it tracks the new state.
      router.refresh();
    } catch {
      setVisibility(previous);
      toast(t("visibility_failed"), { timeout: 4000 });
    } finally {
      setPending(false);
    }
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
      {hasCheckins && <DeleteSection cafeId={cafeId} />}
    </section>
  );
}
