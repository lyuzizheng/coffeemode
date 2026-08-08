"use client";

import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { SerwistProvider } from "@serwist/turbopack/react";
import { Toast } from "@heroui/react";
import { useCallback } from "react";
import type { ReactNode } from "react";
import { getQueryClient } from "@/lib/query/client";
import { persistOptions } from "@/lib/query/persist-options";
import { idbPersister } from "@/lib/query/persister";

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
            swUrl="/serwist/sw.js"
            // Disable the service worker in development to avoid stale caches
            // while iterating on the UI. The route handler is still generated.
            disable={process.env.NODE_ENV === "development"}
            options={{ scope: "/" }}
          >
            <Toast.Provider placement="bottom" maxVisibleToasts={3}>
              {children}
            </Toast.Provider>
          </SerwistProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </NextIntlClientProvider>
  );
}
