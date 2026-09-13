"use client";

import { Button, Drawer } from "@heroui/react";
import { useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { CheckinScores } from "./checkin-scores";
import { CheckinMaxStay } from "./checkin-max-stay";
import { CheckinNoteInput } from "./checkin-note-input";
import { CheckinRepeatBanner } from "./checkin-repeat-banner";
import { CheckinPhotos } from "./checkin-photos";
import { CheckinSuccess } from "./checkin-success";
import { CheckinFormFooter } from "./checkin-form-footer";
import { CheckinDeleteSection } from "./checkin-delete-section";
import { SignInGate } from "@/components/auth/sign-in-gate";
import {
  useCheckinFormState,
  type UseCheckinFormStateOptions,
  CHECKIN_RESUME_PARAM,
} from "./use-checkin-form-state";

export { CHECKIN_RESUME_PARAM };
type CheckinFormProps = UseCheckinFormStateOptions;

function CheckinFormHeader({ cafeName, isEdit }: { cafeName: string; isEdit: boolean }) {
  const t = useTranslations("checkIn");
  return (
    <Drawer.Header className="shrink-0 border-b border-separator px-4 py-3">
      <Drawer.Heading className="truncate font-display text-lg">{cafeName}</Drawer.Heading>
      <Drawer.CloseTrigger className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-secondary">
        <span aria-hidden className="text-xl leading-none">×</span>
        <span className="sr-only">{t("close")}</span>
      </Drawer.CloseTrigger>
      {!isEdit && <p className="mt-1 text-xs text-muted">{t("promptCaption")}</p>}
    </Drawer.Header>
  );
}

function CheckinErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useTranslations("checkIn");
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
      <span>{error}</span>
      <Button variant="outline" size="sm" onPress={onRetry} className="ml-auto h-7 text-xs">
        {t("retry")}
      </Button>
    </div>
  );
}

/**
 * The gate mounts at the bottom of a drawer body that is already scrolled
 * past the fold — without this it lands off-screen and the submit looks
 * dead (BRAWUKA-247). Returns the ref to wrap the gate with.
 */
function useSignInGateScroll(showSignInGate: boolean) {
  const gateRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (showSignInGate) {
      gateRef.current?.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [showSignInGate, reducedMotion]);
  return gateRef;
}

export function CheckinForm(props: CheckinFormProps) {
  const t = useTranslations("checkIn");
  const state = useCheckinFormState(props);
  const signInGateRef = useSignInGateScroll(state.showSignInGate);
  const resumePath =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}?${CHECKIN_RESUME_PARAM}=1`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CheckinFormHeader cafeName={props.cafeName} isEdit={state.isEdit} />

      <Drawer.Body className="flex-1 overflow-y-auto px-4 py-4">
        {state.mutation.view === "success" ? (
          <CheckinSuccess cafeName={props.cafeName} />
        ) : (
          <div className="flex flex-col gap-4">
            {state.repeat.showRepeatBanner && props.lastCheckin && (
              <CheckinRepeatBanner
                lastCheckin={props.lastCheckin}
                onApplySame={state.repeat.applySameAsLast}
                onDismiss={state.repeat.dismissRepeat}
              />
            )}

            <CheckinScores state={state.scoresState} isEdit={state.isEdit} />
            <CheckinMaxStay value={state.maxStay} onChange={state.setMaxStay} />
            <CheckinNoteInput value={state.note} onChange={state.setNote} />

            {!state.isEdit && (
              <div className="space-y-1">
                <div className="text-xs text-muted">{t("photos")}</div>
                <CheckinPhotos
                  photos={state.photos}
                  onChange={state.setPhotos}
                  maxPhotos={6}
                  deferUpload={state.deferUpload}
                  onRequireSignIn={state.requireSignIn}
                />
              </div>
            )}

            {state.mutation.error && (
              <CheckinErrorBanner error={state.mutation.error} onRetry={state.handleRetry} />
            )}

            {state.showSignInGate && (
              <div ref={signInGateRef}>
                <SignInGate message={t("signInGate")} next={resumePath} />
              </div>
            )}
            {state.isEdit && <CheckinDeleteSection onDelete={state.mutation.deleteCheckin} />}
          </div>
        )}
      </Drawer.Body>

      {state.mutation.view !== "success" && (
        <CheckinFormFooter
          view={state.mutation.view}
          isEdit={state.isEdit}
          canSubmit={state.canSubmit}
          isOffline={state.isOffline}
          overallIsNull={state.scoresState.overall === null}
          onSubmit={state.handleSubmit}
        />
      )}
    </div>
  );
}
