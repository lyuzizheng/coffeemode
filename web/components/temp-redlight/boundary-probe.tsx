// TEMPORARY layer-boundary red-light probe for BRAWUKA-177. Reverted in the next commit.
import { getCafe } from "@/lib/db/cafes";

export async function BoundaryProbe({ id }: { id: string }) {
  const cafe = await getCafe(id);
  return <span>{cafe?.name}</span>;
}
