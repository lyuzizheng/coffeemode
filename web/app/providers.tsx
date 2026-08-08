"use client";

import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";
import { getQueryClient } from "@/lib/query/client";
import { persistOptions } from "@/lib/query/persist-options";

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

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SerwistProvider
            swUrl="/serwist/sw.js"
            // Disable the service worker in development to avoid stale caches
            // while iterating on the UI. The route handler is still generated.
            disable={process.env.NODE_ENV === "development"}
            options={{ scope: "/" }}
          >
            {children}
          </SerwistProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </NextIntlClientProvider>
  );
}
