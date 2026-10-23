"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Server endpoint that turns a magic-link token pair into session cookies. */
const SESSION_ENDPOINT = "/api/auth/session";

/**
 * Magic-link session bridge (BRAWUKA-956).
 *
 * Supabase's hosted `/auth/v1/verify` answers a link that carries no PKCE
 * challenge with a 303 to `#access_token=…&refresh_token=…`. A URL fragment
 * never reaches the server, so `/auth/callback` cannot exchange it. This
 * component posts the pair to `/api/auth/session`, where the server-side
 * `@supabase/ssr` client writes the same cookies the OAuth flow does. It
 * renders nothing and adds no auth library to the browser bundle.
 *
 * The fragment is stripped before the request starts: tokens must not survive
 * in the address bar, session history, or any later `Referer`.
 */
export function HashSessionBridge() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("access_token=") && !hash.includes("error=")) return;

    const params = new URLSearchParams(hash.slice(1));
    // Drop the fragment synchronously — before any await, and also when the
    // payload turns out to be unusable.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    if (params.get("error")) {
      router.replace("/?auth=error");
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      router.replace("/?auth=error");
      return;
    }

    let cancelled = false;
    void fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
    })
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          router.replace("/?auth=error");
          return;
        }
        // Server Components read the session from cookies; re-render them so
        // the page that just landed reflects the signed-in state.
        router.refresh();
      })
      .catch(() => {
        if (!cancelled) router.replace("/?auth=error");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
