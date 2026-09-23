import { GenericNotFound } from "@/components/errors/generic-not-found";

/**
 * Global 404 dispatcher (spec 0002: error states are designed). Unmatched
 * routes commit the 404 status at routing time.
 *
 * Gone-cafe deep links do NOT come through here (BRAWUKA-658): /cafes/[id]
 * is a matched route whose generateMetadata() calls notFound(), so the
 * segment boundary at app/cafes/[id]/not-found.tsx renders the designed
 * gone-cafe surface (DG19) with the DG111 recovery block reading the
 * attempted id from route params.
 */
export default function NotFound() {
  return <GenericNotFound />;
}
