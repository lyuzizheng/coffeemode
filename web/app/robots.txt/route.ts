import { buildRobotsTxt } from "@/lib/robots";
import { getRequestOrigin } from "@/lib/site-origin";

// Request-time origin: never prerendered at build (DG105/DG110). A plain
// route handler (not MetadataRoute) because robots.txt needs custom lines —
// AI user-agent groups and Content-Signal — that MetadataRoute cannot emit.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const origin = await getRequestOrigin();
  return new Response(buildRobotsTxt(origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
