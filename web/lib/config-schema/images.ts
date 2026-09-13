import { boundedNumber, positiveInteger } from "./primitives";
import type { AppConfig } from "./types";

/** Validate the `images` subtree of app.yaml. */
export function parseImagesSection(
  file: string,
  images: Record<string, unknown>,
): AppConfig["images"] {
  return {
    maxOriginalDimension: positiveInteger(
      file,
      "images.maxOriginalDimension",
      images.maxOriginalDimension,
    ),
    webpQuality: boundedNumber(file, "images.webpQuality", images.webpQuality, 1, 100),
    r2DownloadTimeoutMs: positiveInteger(
      file,
      "images.r2DownloadTimeoutMs",
      images.r2DownloadTimeoutMs,
    ),
    r2UploadTimeoutMs: positiveInteger(
      file,
      "images.r2UploadTimeoutMs",
      images.r2UploadTimeoutMs,
    ),
    downloadSlackBytes: positiveInteger(
      file,
      "images.downloadSlackBytes",
      images.downloadSlackBytes,
    ),
  };
}
