import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CoffeeMode",
    short_name: "CoffeeMode",
    description:
      "Real wifi, outlet, and seat intel for digital nomads — find the perfect cafe to work from.",
    start_url: "/?source=pwa",
    display: "standalone",
    display_override: ["standalone", "browser"],
    orientation: "portrait",
    scope: "/",
    background_color: "#faf8f5",
    theme_color: "#b55a38",
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
