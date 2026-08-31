"use client";

import { Card, Chip, Input, Label, TextField } from "@heroui/react";
import { useTranslations } from "next-intl";
import type { POI } from "@shared/places/types";

export function POIPreview({
  poi,
  name,
  onNameChange,
}: {
  poi: POI;
  name: string;
  onNameChange: (name: string) => void;
}) {
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
