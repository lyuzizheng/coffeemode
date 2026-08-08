import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { requestUploadUrl } from "@/lib/images/image-service-client";

/**
 * POST /api/images/upload
 *
 * Returns a presigned R2 PUT URL for the browser to upload the original WebP image.
 * The session is verified here; the image-service Worker only sees a service token.
 */
export async function POST() {
  const user = await getCurrentUser();
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
