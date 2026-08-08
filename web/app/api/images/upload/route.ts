import { NextResponse } from "next/server";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { requestUploadUrl } from "@/lib/images/image-service-client";

async function getUser(): Promise<{ id: string } | null> {
  if (!isAuthConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/**
 * POST /api/images/upload
 *
 * Returns a presigned R2 PUT URL for the browser to upload the original WebP image.
 * The session is verified here; the image-service Worker only sees a service token.
 */
export async function POST() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const data = await requestUploadUrl();
    return NextResponse.json(data);
  } catch (err) {
    console.error("/api/images/upload failed", err);
    return NextResponse.json({ error: "image_service_error" }, { status: 502 });
  }
}
