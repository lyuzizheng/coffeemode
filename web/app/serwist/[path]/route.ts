import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision: process.env.NEXT_BUILD_ID ?? Date.now().toString() }],
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
  });
