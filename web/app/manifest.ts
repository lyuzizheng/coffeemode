import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, BACKGROUND_COLOR, THEME_COLOR } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/?source=pwa",
    display: "standalone",
    display_override: ["standalone", "browser"],
    orientation: "portrait",
    scope: "/",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [],
  };
}
