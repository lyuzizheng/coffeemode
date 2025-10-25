import { LinkPreviewResult, LinkType } from '../types/linkPreview';
import { getApiClient, ApiResponse } from './api';

function detectLinkType(url: string): LinkType {
  const { hostname } = new URL(url);
  const host = hostname.toLowerCase();
  if (
    host.includes('google.com') ||
    host.includes('maps.google.com') ||
    host.includes('maps.app.goo.gl')
  ) {
    return 'google_maps';
  }
  if (
    host.includes('xiaohongshu.com') ||
    host.includes('xhslink.com') ||
    host.includes('xhs')
  ) {
    return 'xiaohongshu';
  }
  return 'generic';
}

function extractFtid(url: string): string | null {
  try {
    const u = new URL(url);
    const ftid = u.searchParams.get('ftid');
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

  const client = getApiClient('https://api.microlink.io');

  let dRoot: any = null;
  try {
    const res = await client.get('/', {
      params: {
        url,
        audio: false,
        video: false,
        iframe: false,
      },
    });

    const apiRes = res.data as ApiResponse<any>;
    dRoot = apiRes?.data ?? null; // Microlink raw response lives here
  } catch (e) {
    return {
      type,
      metadata: {
        url,
        title: type === 'google_maps' ? 'Google Maps' : undefined,
        description: undefined,
        imageUrl: undefined,
        logoUrl: faviconForUrl(url),
        siteName: undefined,
        lang: undefined,
        author: null,
        publisher: null,
        date: null,
        ftid: type === 'google_maps' ? extractFtid(url) : null,
      },
    };
  }

  // Microlink wraps the actual content under dRoot.data
  const d = dRoot?.data || {};

  const imageUrl: string | undefined = d?.image?.url || undefined;
  const logoUrl: string | undefined = d?.logo?.url || faviconForUrl(url);

  return {
    type,
    metadata: {
      url: d?.url || url,
      title: d?.title || (type === 'google_maps' ? 'Google Maps' : undefined),
      description: d?.description || undefined,
      imageUrl,
      logoUrl,
      siteName: d?.publisher || dRoot?.source || undefined,
      lang: d?.lang || undefined,
      author: d?.author ?? null,
      publisher: d?.publisher ?? null,
      date: d?.date ?? null,
      ftid: type === 'google_maps' ? extractFtid(d?.url || url) : null,
    },
  };
}