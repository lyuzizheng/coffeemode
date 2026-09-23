import { GoneCafeNotFound } from "@/components/errors/gone-cafe-not-found";

/**
 * Segment 404 for /cafes/[id] — the DG19 gone-cafe surface. The page's
 * generateMetadata() calls notFound() before the shell flushes, which
 * commits the real 404 status (BRAWUKA-658: no loading boundary wraps this
 * route — the map-home skeleton lives in app/(home)/loading.tsx). The
 * recovery block reads the attempted id from route params (DG111).
 */
export default function CafeNotFound() {
  return <GoneCafeNotFound />;
}
