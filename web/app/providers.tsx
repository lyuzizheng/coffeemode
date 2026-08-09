"use client";

import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Toast } from "@heroui/react";
import { SharedElementTransition } from "react-aria-components";
import { useCallback } from "react";
import type { ReactNode } from "react";
import { getQueryClient } from "@/lib/query/client";
import { persistOptions } from "@/lib/query/persist-options";
import { idbPersister } from "@/lib/query/persister";
import { SW_URL } from "@/lib/sw-rules";

export function Providers({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: string;
  messages: Record<string, unknown>;
}) {
  const queryClient = getQueryClient();

  const handleRestoreError = useCallback(async () => {
    console.error("Failed to restore persisted query cache; clearing persisted state.");
    try {
      await idbPersister.removeClient();
    } catch (e) {
      console.error("Failed to remove persisted query client", e);
    }
    queryClient.clear();
  }, [queryClient]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
        onError={handleRestoreError}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SerwistProvider
            swUrl={SW_URL}
            // Disable the service worker in development to avoid stale caches
            // while iterating on the UI. The route handler is still generated.
            disable={process.env.NODE_ENV === "development"}
            options={{ scope: "/" }}
          >
            {/*
             * Toast.Provider is a toast REGION, not a wrapper: HeroUI's
             * `children` prop is the per-toast render function, so wrapping
             * the app in it rendered NOTHING (the whole page became the
             * region's toast renderer and the empty queue rendered nothing).
             * Mount it as a sibling that owns the fixed-position region;
             * toast() calls from anywhere still render into it.
             * (Review 2026-08-09 P0: blank pages on every route.)
             */}
            <Toast.Provider placement="bottom" maxVisibleToasts={3} />
            {/*
             * react-aria-components 1.20's SelectionIndicator (inside HeroUI
             * Tabs/Select/etc.) renders a <SharedElement> that throws unless a
             * SharedElementTransition ancestor provides its context — on the
             * server AND the client. This is a pure context provider (no DOM
             * cost); wrapping app-wide future-proofs every HeroUI collection.
             * (Review 2026-08-09 P0: blank pages on every route.)
             */}
            <SharedElementTransition>{children}</SharedElementTransition>
          </SerwistProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </NextIntlClientProvider>
  );
}
