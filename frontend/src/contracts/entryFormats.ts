export const POST_FORMATS = ["mixed_media"] as const;

export type EntryFormat = (typeof POST_FORMATS)[number];
export type TextEntryGradient =
  | "fire"
  | "sunrise"
  | "cool"
  | "green"
  | "coral"
  | "ember"
  | "plum"
  | "deep"
  | "ink";

export type EntryFormatData = {
  share_review?: { material_node_count: number; intent: string | null; question: string | null };
  round_attribution?: {
    template_key: string;
    cover_artifact_id?: number;
    cover_contributor_id?: number;
    cover_contributor_name?: string;
    cover_label?: string;
  };
  /** Historical persisted attribution field. */
  round_activity?: {
    activity_key: string;
    cover_artifact_id?: number;
    cover_contributor_id?: number;
    cover_contributor_name?: string;
    cover_label?: string;
  };
  title?: string;
  name?: string;
  text?: string;
  url?: string;
  image_url?: string;
  thumbnail_url?: string;
  audio_asset_id?: number;
  video_asset_id?: number;
  duration_ms?: number;
  gradient?: TextEntryGradient;
  text_style?: { background: string; color: string };
  preserved_from_chat?: boolean;
};

export function postTypeToFormat(postType: string): EntryFormat | null {
  const normalized = postType === "mixed-media" ? "mixed_media" : postType;
  return POST_FORMATS.includes(normalized as EntryFormat) ? (normalized as EntryFormat) : null;
}
