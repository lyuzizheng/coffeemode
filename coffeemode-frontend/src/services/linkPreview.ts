import { ApiResponse } from "@/types/api";
import { LinkPreviewResult, LinkType } from "../types/linkPreview";
import { getApiClient } from "./api";

interface MicrolinkImage { url?: string }
interface MicrolinkLogo { url?: string }
interface MicrolinkData {
  title?: string
  publisher?: string | null
  image?: MicrolinkImage
  url?: string
  description?: string
  logo?: MicrolinkLogo
}
interface MicrolinkResponse {
  status?: string
  statusCode?: number
  data?: MicrolinkData
}

function detectLinkType(url: string): LinkType {
  const { hostname } = new URL(url);
  const host = hostname.toLowerCase();
  if (
    host.includes("google.com") ||
    host.includes("maps.google.com") ||
    host.includes("maps.app.goo.gl")
  ) {
    return "google_maps";
  }
  if (
    host.includes("xiaohongshu.com") ||
    host.includes("xhslink.com") ||
    host.includes("xhs")
  ) {
    return "xiaohongshu";
  }
  return "generic";
}

function extractFtid(url: string): string | null {
  try {
    const u = new URL(url);
    const ftid = u.searchParams.get("ftid");
    if (ftid) return ftid;
    const path = u.pathname;
    const match = path.match(/ftid=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function faviconForUrl(url: string, size: number = 128): string {
  const { hostname } = new URL(url);
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`;
}

export async function unfurlLink(url: string): Promise<LinkPreviewResult> {
  const type = detectLinkType(url);

  const client = getApiClient("https://api.microlink.io");

  let root: MicrolinkResponse | null = null;
  try {
    const res = await client.get("/", {
      params: {
        url,
        audio: false,
        video: false,
        iframe: false,
        filter: "title,publisher,image.url,url,description,logo.url",
      },
    });

    const apiRes = res.data as ApiResponse<MicrolinkResponse>;
    root = apiRes?.data ?? null;
  } catch {
    return {
      type,
      metadata: {
        url,
        title: type === "google_maps" ? "Google Maps" : undefined,
        description: undefined,
        imageUrl: undefined,
        logoUrl: faviconForUrl(url),
        siteName: undefined,
        ftid: type === "google_maps" ? extractFtid(url) : null,
      },
    };
  }

  const d: MicrolinkData = root?.data ?? (root as unknown as MicrolinkData) ?? {};

  const imageUrl: string | undefined = d.image?.url || undefined;
  const logoUrl: string | undefined = d.logo?.url || faviconForUrl(url);

  return {
    type,
    metadata: {
      url: d.url || url,
      title: d.title || (type === "google_maps" ? "Google Maps" : undefined),
      description: d.description || undefined,
      imageUrl,
      logoUrl,
      siteName: d.publisher || undefined,
      ftid: type === "google_maps" ? extractFtid(d.url || url) : null,
    },
  };
}
