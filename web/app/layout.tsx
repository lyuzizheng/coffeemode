import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "./providers";
import { OfflineBanner } from "@/components/offline-banner";
import "./globals.css";

const APP_NAME = "CoffeeMode";
const APP_DESCRIPTION =
  "Real wifi, outlet, and seat intel for digital nomads — find the perfect cafe to work from.";

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
    { media: "(prefers-color-scheme: light)", color: "#b55a38" },
    { media: "(prefers-color-scheme: dark)", color: "#b55a38" },
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
      className={`${inter.variable} ${cabinet.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans">
        <Providers locale={locale} messages={messages}>
          <OfflineBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
