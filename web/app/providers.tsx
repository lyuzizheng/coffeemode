"use client";

import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

export function Providers({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: string;
  messages: Record<string, unknown>;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
