export type LinkPreviewStatus = "ready" | "failed";

export type LinkPreview = {
  id: number;
  url: string;
  canonical_url?: string | null;
  title?: string | null;
  description?: string | null;
  site_name?: string | null;
  image_url?: string | null;
  favicon_url?: string | null;
  accent_color?: string | null;
  status: LinkPreviewStatus;
  error_code?: string | null;
};

export type LinkPreviewAttachment = {
  source_url?: string | null;
  hidden: boolean;
  preview?: LinkPreview | null;
};

export type LinkPreviewAttachmentInput = {
  source_url?: string | null;
  hidden?: boolean;
};
