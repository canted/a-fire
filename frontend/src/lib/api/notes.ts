import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "put" | "patch" | "delete">;
import { defaultTiptapDoc, type TiptapDoc } from "../tiptap";

export type Note = {
  id: number;
  title: string | null;
  icon: string | null;
  room_id?: number | null;
  parent_id?: number | null;
  content: TiptapDoc;
  version?: number | null;
  can_manage?: boolean;
};

export type LegacyNotePayload = {
  page: Note;
};

type V2NotePayload = {
  note: Note;
};

function extractNote(response: LegacyNotePayload | V2NotePayload | Note): Note {
  if (response && typeof response === "object" && "page" in response) {
    return (response as LegacyNotePayload).page;
  }
  if (response && typeof response === "object" && "note" in response) {
    return (response as V2NotePayload).note;
  }
  return response as Note;
}

export async function fetchNote(client: ApiClient, pageId: string | number): Promise<Note> {
  const response = await client.get<LegacyNotePayload | V2NotePayload | Note>(`/v2/notes/${pageId}`);
  return normalizeNote(extractNote(response));
}

export async function updateNote(
  client: ApiClient,
  pageId: string | number,
  attrs: { title?: string | null; icon?: string | null },
): Promise<Note> {
  const response = await client.patch<LegacyNotePayload | V2NotePayload | Note>(`/v2/notes/${pageId}`, { note: attrs });
  return normalizeNote(extractNote(response));
}

export async function saveNoteContent(client: ApiClient, pageId: string | number, content: TiptapDoc, expectedVersion: number): Promise<Note> {
  const response = await client.put<LegacyNotePayload | V2NotePayload | Note>(`/v2/notes/${pageId}/content`, { content, expected_version: expectedVersion });
  return normalizeNote(extractNote(response));
}

export async function prependNoteContentBlocks(
  client: ApiClient,
  pageId: string | number,
  blocks: NonNullable<TiptapDoc["content"]>,
): Promise<Note> {
  const response = await client.post<LegacyNotePayload | V2NotePayload | Note>(`/v2/notes/${pageId}/content/blocks`, {
    blocks,
    position: "top",
  });
  return normalizeNote(extractNote(response));
}

export async function insertNoteContentBlocksAfterAudio(
  client: ApiClient,
  pageId: string | number,
  payload: {
    blocks: NonNullable<TiptapDoc["content"]>;
    audioAssetId: string | number;
    audioNodeId?: string | number | null;
  },
): Promise<Note> {
  const response = await client.post<LegacyNotePayload | V2NotePayload | Note>(`/v2/notes/${pageId}/content/blocks`, {
    blocks: payload.blocks,
    position: "after_audio",
    audio_asset_id: payload.audioAssetId,
    audio_node_id: payload.audioNodeId ?? null,
  });
  return normalizeNote(extractNote(response));
}

export async function createNote(
  client: ApiClient,
  roomId: string | number,
  title?: string,
  parentId?: string | number | null,
  options?: { insertParentLink?: boolean },
): Promise<Note> {
  const response = await client.post<LegacyNotePayload | V2NotePayload | Note>(`/v2/notes`, {
    room_id: roomId,
    title,
    parent_id: parentId ?? null,
    ...(options?.insertParentLink ? { insert_parent_link: true } : {}),
  });
  return normalizeNote(extractNote(response));
}

export async function deleteNote(client: ApiClient, pageId: string | number): Promise<void> {
  await client.delete<void>(`/v2/notes/${pageId}`);
}

export type NoteTreeNode = {
  id: number;
  title: string | null;
  icon: string | null;
  parent_id: number | null;
  updated_at?: string | null;
  children: NoteTreeNode[];
};

export type NoteTreePayload = {
  room_id: number;
  pages: NoteTreeNode[];
};

export async function fetchNoteTree(client: ApiClient, roomId: string | number): Promise<NoteTreePayload> {
  const response = await client.get<NoteTreePayload & { notes?: NoteTreeNode[] }>(
    `/v2/notes/tree?room_id=${encodeURIComponent(String(roomId))}`,
  );
  return {
    room_id: response.room_id ?? Number(roomId),
    pages: response.pages ?? response.notes ?? [],
  };
}

function normalizeNote(page: Note): Note {
  const rawContent = page.content as unknown;
  const nestedContent =
    rawContent && typeof rawContent === "object" && "default" in (rawContent as object)
      ? (rawContent as { default?: unknown }).default
      : null;
  const contentCandidate = rawContent && typeof rawContent === "object" ? rawContent : nestedContent;
  const content =
    contentCandidate && typeof contentCandidate === "object" && (contentCandidate as { type?: string }).type === "doc"
      ? (contentCandidate as TiptapDoc)
      : defaultTiptapDoc;
  return {
    ...page,
    room_id: page.room_id ?? null,
    content,
  };
}
