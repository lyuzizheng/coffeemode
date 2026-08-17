"use client";

import type { ImageLoader } from "next/image";
import { R2_PUBLIC_HOST } from "./constants";

/**
 * Custom Next.js image loader for R2 images.
 *
 * The image pipeline already generates WebP variants (`original`, `card`,
 * `thumbnail`) and stores them at `images.coffeemode.app`. Re-optimizing
 * those through `/_next/image` adds VPS CPU and complicates CDN caching.
 * This loader returns the direct R2 URL, letting Cloudflare cache the
 * immutable asset forever. Used as `loaderFile` in `next.config.ts`, so it
 * ships in the client bundle — hence the `"use client"` directive (issue #40).
 */
export const r2ImageLoader: ImageLoader = ({ src }) => {
  // If the URL is already an absolute R2 URL, pass it through unchanged.
  if (isR2Image(src)) return src;

  // Non-R2 absolute URLs are passed through so external images are not
  // accidentally rewritten onto the R2 CDN.
  if (src.startsWith("http://") || src.startsWith("https://")) return src;

  // Relative paths are treated as direct R2 keys under the public CDN.
  const clean = src.startsWith("/") ? src.slice(1) : src;
  return `https://${R2_PUBLIC_HOST}/${clean}`;
};

export default r2ImageLoader;

/**
 * Returns true if an image source should use the R2 loader.
 *
 * Use this in components to switch between `r2ImageLoader` and the default
 * Next.js loader for non-R2 images.
 */
export function isR2Image(src: string): boolean {
  // Path boundary after the host: `images.coffeemode.app.evil.com` must not match.
  if (src.startsWith(`https://${R2_PUBLIC_HOST}/`)) return true;
  if (src.startsWith("https://")) {
    try {
      return new URL(src).hostname === R2_PUBLIC_HOST;
    } catch {
      return false;
    }
  }
  return false;
}
