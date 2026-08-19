"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Global error boundary — last-resort page for failures in the root layout.
 *
 * `global-error.tsx` is rendered OUTSIDE the root layout, so it cannot rely on
 * `globals.css`, `next-intl`, `Providers`, or the root layout's font variables.
 * It re-declares `<html>`/`<body>` and inlines the smallest token subset it
 * needs, with `prefers-color-scheme` support for light and dark OS themes.
 *
 * Copy is intentionally short and duplicated in English and Chinese; the active
 * locale cannot be read from next-intl when message loading itself may have
 * failed. We fall back to English on the server/pre-hydration and then use the
 * browser's preferred language on the client.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    () => () => {},
    () => getClientLocale(),
    () => "en",
  );

  useEffect(() => {
    // Keep the real error visible for debugging; the UI stays calm and generic.
    console.error(error);
  }, [error]);

  const t = copy[locale as keyof typeof copy];

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t.title}</title>
        <style>{`
          :root {
            --radius: 0.25rem;
            --background: oklch(98.1% 0.004 82);
            --foreground: oklch(23% 0.022 48);
            --surface: oklch(99.4% 0.002 82);
            --surface-secondary: oklch(96.4% 0.006 76);
            --muted: oklch(44% 0.02 55);
            --accent: oklch(54% 0.15 42);
            --accent-foreground: oklch(98.5% 0.004 80);
            --border: oklch(89.5% 0.008 70);
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --background: oklch(15.5% 0.012 50);
              --foreground: oklch(92.5% 0.009 72);
              --surface: oklch(19.5% 0.013 52);
              --surface-secondary: oklch(23% 0.013 52);
              --muted: oklch(72% 0.015 60);
              --accent: oklch(68% 0.16 46);
              --accent-foreground: oklch(17% 0.015 48);
              --border: oklch(29.5% 0.012 52);
            }
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            min-height: 100dvh;
            font-family:
              system-ui,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              Roboto,
              "Helvetica Neue",
              Arial,
              "Noto Sans",
              sans-serif,
              "Apple Color Emoji",
              "Segoe UI Emoji";
            background: var(--background);
            color: var(--foreground);
          }

          .cm-focus:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
        `}</style>
      </head>
      <body
        style={{
          display: "flex",
          minHeight: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily:
              '"SF Mono", "Monaco", "Inconsolata", "Fira Code", "Droid Sans Mono", monospace',
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
            color: "var(--muted)",
            textTransform: "uppercase",
          }}
        >
          {t.kicker}
        </p>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: "-0.025em",
            }}
          >
            {t.title}
          </h1>
          <p
            style={{
              margin: "0.75rem 0 0",
              maxWidth: "20rem",
              fontSize: "1rem",
              lineHeight: 1.625,
              color: "var(--muted)",
            }}
          >
            {t.body}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={reset}
            className="cm-focus"
            style={{
              height: "2.5rem",
              borderRadius: "var(--radius)",
              border: "none",
              padding: "0 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              cursor: "pointer",
              transition: "opacity 150ms ease",
            }}
          >
            {t.retry}
          </button>
          <Link
            href="/"
            className="cm-focus"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "2.5rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              padding: "0 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
              background: "var(--surface)",
              color: "var(--foreground)",
              transition: "background 150ms ease",
            }}
          >
            {t.home}
          </Link>
        </div>
      </body>
    </html>
  );
}

function getClientLocale(): "en" | "zh" {
  const preferred =
    typeof navigator !== "undefined" ? navigator.language : "";
  return preferred.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const copy = {
  en: {
    kicker: "Error",
    title: "Something went wrong",
    body: "An unexpected error occurred. Please try again or return home.",
    retry: "Retry",
    home: "Home",
  },
  zh: {
    kicker: "错误",
    title: "出了点问题",
    body: "发生意外错误，请重试或返回首页。",
    retry: "重试",
    home: "首页",
  },
};
