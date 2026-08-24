import { headers } from "next/headers";
import { GenericNotFound } from "@/components/errors/generic-not-found";
import { GoneCafeNotFound } from "@/components/errors/gone-cafe-not-found";

/**
 * Global 404 dispatcher (spec 0002: error states are designed). Unmatched
 * routes commit the 404 status at routing time, so this surface is also
 * where the proxy sends gone-cafe deep links (DG19): a matched route would
 * stream its shell with a 200 before any page-level notFound() could run.
 * The proxy marks those requests with x-gone-cafe-id; the attempted id
 * feeds the DG111 recovery block.
 */
export default async function NotFound() {
  const goneCafeId = (await headers()).get("x-gone-cafe-id");
  if (goneCafeId) return <GoneCafeNotFound cafeId={goneCafeId} />;
  return <GenericNotFound />;
}
