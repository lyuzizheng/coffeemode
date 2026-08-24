import { ImageResponse } from "next/og";
import { isValidUUID } from "@shared/uuid";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getCafe } from "@/lib/db/cafes";
import { BACKGROUND_COLOR } from "@/lib/site";
import {
  CAFES_READ_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

/**
 * Dynamic og:image fallback (artifact §4): for cafes without a cover, the
 * social card is a flat background-colored card with the cup glyph and the
 * cafe name — designed, not broken. generateMetadata points here only when
 * no cover exists; cafes with photos use the cover directly.
 *
 * Colors mirror the light design tokens in hex (oklch is not portable to
 * every link-preview renderer). Self-hosted display fonts are woff2, which
 * Satori cannot embed, so the name renders in the default face.
 */
const INK = "#261a14"; // --foreground (light)
const MUTED = "#5f524c";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return new Response("Not found", { status: 404 });
  }

  // Satori renders are the most CPU-expensive read in the cafes family;
  // same anonymous bucket as the other DB-reading GETs (DG74).
  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `cafes-read:${clientId}`,
    CAFES_READ_RATE_LIMIT.windowMs,
    CAFES_READ_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  let cafe: Awaited<ReturnType<typeof getCafe>> = null;
  try {
    cafe = await getCafe(id);
  } catch (err) {
    console.error("/cafes/[id]/og-image GET failed", err);
    return new Response("Internal error", { status: 500 });
  }
  if (!cafe) {
    return new Response("Not found", { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "28px",
          background: BACKGROUND_COLOR,
        }}
      >
        {/* CoffeeIcon cup glyph, enlarged (16x16 viewBox at 4x). */}
        <svg
          width="64"
          height="64"
          viewBox="0 0 16 16"
          fill="none"
          stroke={MUTED}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 5.5h8V9a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 9V5.5Z" />
          <path d="M11.5 6.5h1.25a1.75 1.75 0 0 1 0 3.5H11.5" />
        </svg>
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            color: INK,
            textAlign: "center",
            padding: "0 80px",
            overflow: "hidden",
          }}
        >
          {cafe.name}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#b34917" }}>CoffeeMode</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
