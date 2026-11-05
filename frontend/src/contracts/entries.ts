export type ReflectionSummary = {
  pageId: number | string;
  pageTitle: string | null;
  pageIcon: string | null;
  count: number;
  mine: boolean;
};

export type EntryProvenance = {
  source_message_id: number | null;
  saved_by: {
    id: number;
    display_username: string;
  } | null;
  label: string;
};
