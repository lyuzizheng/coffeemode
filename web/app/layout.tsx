import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";
import { OfflineBanner } from "@/components/offline-banner";
import { CheckinResume } from "@/components/checkin/checkin-resume";
import { appConfig } from "@/lib/config";
import "./globals.css";
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR } from "@/lib/site";

// Self-hosted fonts (OFL). No runtime Google Fonts — files live in app/fonts
// and are served by Next.js with zero layout shift (size-adjust fallbacks).
const inter = localFont({
  src: "./fonts/inter-var.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const cabinet = localFont({
  src: [
    { path: "./fonts/cabinet-grotesk-400.woff2", weight: "400" },
    { path: "./fonts/cabinet-grotesk-500.woff2", weight: "500" },
    { path: "./fonts/cabinet-grotesk-700.woff2", weight: "700" },
    { path: "./fonts/cabinet-grotesk-800.woff2", weight: "800" },
  ],
  variable: "--font-cabinet",
  display: "swap",
});

const jetbrains = localFont({
  src: "./fonts/jetbrains-mono-var.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

// Editorial serif — Source Serif 4 Variable (OFL), opsz 8–60 + wght 200–900.
// Latin-subset woff2 (~242KB) built from google/fonts SourceSerif4[opsz,wght].ttf.
// Narrative reading only (check-in notes, editorial surfaces); forbidden on
// utility chrome — spec 0002 typography. CJK falls back to system Songti.
const sourceSerif = localFont({
  src: "./fonts/source-serif-4-var.woff2",
  variable: "--font-source-serif",
  weight: "200 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: "%s · CoffeeMode",
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    apple: "/icons/apple-touch-icon-180x180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${cabinet.variable} ${jetbrains.variable} ${sourceSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans">
        <Providers locale={locale} messages={messages}>
          <OfflineBanner />
          {children}
          <CheckinResume draftTtlHours={appConfig.checkins.pendingDraftTtlHours} />
        </Providers>
      </body>
    </html>
  );
}
