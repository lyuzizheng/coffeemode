export type LinkType = "google_maps" | "xiaohongshu" | "generic";

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  logoUrl?: string;
  siteName?: string;
  ftid?: string | null;
}

export interface LinkPreviewResult {
  type: LinkType;
  metadata: LinkMetadata;
}
