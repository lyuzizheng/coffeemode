"use client";

import { Button, Drawer } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CafePlaceSearch } from "./cafe-place-search";
import { CafeCreationForm } from "./cafe-creation-form";
import { useNetworkStatus } from "@/hooks/use-network-status";
import type { POI } from "@shared/places/types";

async function persistExternalPlace(selected: POI): Promise<boolean> {
  const response = await fetch("/api/places/external", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pois: [selected] }),
  });
  return response.ok;
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
  const [poi, setPoi] = useState<POI | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPoi(null);
    setName("");
    setError(null);
  };

  const handleSelectPOI = async (selected: POI, persist = false) => {
    setError(null);
    if (persist) {
      const ok = await persistExternalPlace(selected);
      if (!ok) {
        setError(t("searchFailed"));
        return;
      }
    }
    setPoi(selected);
    setName(selected.name);
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
          <Drawer.Header>
            <Drawer.Heading>{t("title")}</Drawer.Heading>
            <p className="text-sm text-muted">{t("firstCheckinHint")}</p>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-5 pb-4">
              <CafePlaceSearch onSelectPOI={handleSelectPOI} onError={setError} />

              {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

              {poi ? (
                <CafeCreationForm
                  poi={poi}
                  name={name}
                  onNameChange={setName}
                  isAuthenticated={isAuthenticated}
                  onError={setError}
                />
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
