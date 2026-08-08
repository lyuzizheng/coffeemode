"use client";

import { Avatar, Tabs } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Section } from "../shared";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="tnum font-display text-xl font-bold text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

function EmptyList({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-secondary p-6 text-center">
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

function ProfileHeader() {
  const t = useTranslations("profile");
  return (
    <div className="flex items-center gap-4">
      <Avatar size="lg">
        <Avatar.Fallback className="bg-secondary text-secondary-foreground">
          {t("mockInitials")}
        </Avatar.Fallback>
      </Avatar>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
          {t("mockName")}
        </h3>
        <p className="text-sm text-muted">
          {t("city")}: {t("mockCity")}
        </p>
      </div>
    </div>
  );
}

export function ProfileSection() {
  const t = useTranslations("themePreview.profilePreview");
  const tp = useTranslations("profile");

  return (
    <Section index="11" title={t("title")} desc={t("desc")}>
      <div className="mx-auto w-full max-w-lg rounded-md border border-border bg-surface p-5">
        <ProfileHeader />

        <div className="mt-5 grid grid-cols-3 gap-4 border-y border-separator py-4">
          <Stat label={tp("statsCafes")} value={12} />
          <Stat label={tp("statsCheckins")} value={48} />
          <Stat label={tp("statsCities")} value={3} />
        </div>

        <div className="mt-5">
          <Tabs.Root defaultSelectedKey="cafes" variant="secondary" aria-label={tp("title")}>
            <Tabs.ListContainer>
              <Tabs.List>
                <Tabs.Tab id="cafes">{tp("myCafes")}</Tabs.Tab>
                <Tabs.Tab id="checkins">{tp("myCheckins")}</Tabs.Tab>
                <Tabs.Indicator />
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id="cafes" className="pt-4">
              <EmptyList text={tp("emptyCafes")} />
            </Tabs.Panel>
            <Tabs.Panel id="checkins" className="pt-4">
              <EmptyList text={tp("emptyCheckins")} />
            </Tabs.Panel>
          </Tabs.Root>
        </div>
      </div>
    </Section>
  );
}
