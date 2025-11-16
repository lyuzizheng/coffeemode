export type LinkType = "google_maps" | "xiaohongshu" | "generic";

export interface LinkMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  logoUrl?: string;
  url: string;
  siteName?: string;
  lang?: string;
  author?: string | null;
  publisher?: string | null;
  date?: string | null; // ISO string if available
  ftid?: string | null; // Google Maps feature id extracted from URL if present
}

export interface LinkPreviewResult {
  type: LinkType;
  metadata: LinkMetadata;
}
