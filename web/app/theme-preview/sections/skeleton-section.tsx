"use client";

import { Button, Skeleton } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DIMS, Section, WorkBar } from "../shared";

export function SkeletonSection() {
  const t = useTranslations("themePreview.skeleton");
  const tc = useTranslations("themePreview.cards");
  const [loading, setLoading] = useState(true);
  return (
    <Section index="06" title={t("title")} desc={t("desc")}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_auto]">
        <div
          className="w-full max-w-sm rounded-xl border border-border bg-surface p-5"
          aria-busy={loading}
          aria-label={loading ? t("loading_aria") : undefined}
        >
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <div className="space-y-2.5 pt-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-1.5 flex-1 rounded-full" />
                    <Skeleton className="h-3 w-7" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
                {tc("cafe_name")}
              </h3>
              <p className="text-sm text-muted">{tc("cafe_area")}</p>
              <div className="space-y-2.5 pt-3">
                {DIMS.map((d) => (
                  <WorkBar key={d.key} label={tc(`dims.${d.key}`)} value={d.value} reduced />
                ))}
              </div>
              <p className="tnum font-mono text-xs text-muted">
                {tc("distance")} · {tc("check_ins")}
              </p>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          onPress={() => setLoading((v) => !v)}
          className="shrink-0"
        >
          {loading ? t("show_loaded") : t("show_loading")}
        </Button>
      </div>
    </Section>
  );
}
