import type { ImageLoader } from "next/image";

const R2_PUBLIC_HOST = "images.coffeemode.app";

/**
 * Custom Next.js image loader for R2 images.
 *
 * The image pipeline already generates WebP variants (`original`, `card`,
 * `thumbnail`) and stores them at `images.coffeemode.app`. Re-optimizing
 * those through `/_next/image` adds VPS CPU and complicates CDN caching.
 * This loader returns the direct R2 URL, letting Cloudflare cache the
 * immutable asset forever.
 */
export const r2ImageLoader: ImageLoader = ({ src }) => {
  // If the URL is already an absolute R2 URL, pass it through unchanged.
  if (src.startsWith(`https://${R2_PUBLIC_HOST}`) || src.startsWith("https://") && new URL(src).hostname === R2_PUBLIC_HOST) {
    return src;
  }

  // Relative paths are treated as direct R2 keys under the public CDN.
  const base = `https://${R2_PUBLIC_HOST}`;
  const clean = src.startsWith("/") ? src.slice(1) : src;
  return `${base}/${clean}`;
};

/**
 * Returns true if an image source should use the R2 loader.
 *
 * Use this in components to switch between `r2ImageLoader` and the default
 * Next.js loader for non-R2 images.
 */
export function isR2Image(src: string): boolean {
  if (src.startsWith(`https://${R2_PUBLIC_HOST}`)) return true;
  if (src.startsWith("https://")) {
    try {
      return new URL(src).hostname === R2_PUBLIC_HOST;
    } catch {
      return false;
    }
  }
  return false;
}
