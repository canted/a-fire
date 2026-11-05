export type EntrySubjectType = "plain_text" | "note" | "page" | "audio_asset" | "video_asset" | "image" | "link";

export type EntrySubjectMode = "auto" | "manual" | "none";

export type EntrySubjectPayload = {
  type: EntrySubjectType;
  id?: string | number | null;
  key?: string | null;
  sourceNodeId?: string | null;
  label?: string | null;
  preview?: Record<string, unknown> | null;
  mode?: EntrySubjectMode;
};

export type SubjectDetectionResult = {
  primary: EntrySubjectPayload;
  candidates: EntrySubjectPayload[];
  confidence: "none" | "low" | "high";
  reason: string;
};
