import { GoneCafeNotFound } from "@/components/errors/gone-cafe-not-found";

/**
 * Segment 404 for /cafes/[id]. Defensive surface only: the proxy commits
 * the real 404 for gone/invalid ids before routing (see web/proxy.ts and
 * app/not-found.tsx); this boundary catches the narrow race where a cafe
 * disappears between the proxy check and the page render. In that streamed
 * case the status degrades to a soft-404 but the designed surface still
 * renders. The recovery block reads the attempted id from the route params.
 */
export default function CafeNotFound() {
  return <GoneCafeNotFound />;
}
