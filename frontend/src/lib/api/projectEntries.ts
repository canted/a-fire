import type { EntryShareManifest } from "../entryShareSelection";
import { assertImageFile } from "../imageFile";
import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "put" | "patch" | "delete">;
import type { TiptapDoc } from "../tiptap";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";

import type { ProjectPerson, ProjectSummary } from "./projects";
export type { ProjectPerson, ProjectSummary } from "./projects";
import { keepChatMessage, projectFields, createProjectRecord, updateProjectRecord } from "./projects";

export type ProjectEntry = {
  automated_creation?: boolean;
  id: number;
  kind: "material" | "feedback";
  author: ProjectPerson;
  created_at: string;
  updated_at: string;
  content: TiptapDoc;
  format: EntryFormat;
  format_data?: EntryFormatData | null;
  intent?: string | null;
  question?: string | null;
  lyrics?: string | null;
  draft?: boolean;
  status?: string;
  source_entry_id?: number | null;
  source_shared_entry_id?: number | null;
  source_reply_id?: number | null;
  source_chat_message_id?: number | null;
  source_room_id?: number | null;
  source_author_name?: string | null;
  source_available?: boolean;
  can_edit: boolean;
  can_share: boolean;
  submissions_next_cursor?: string | null;
  submissions: Array<{
    id: number;
    room_id: number;
    room_name: string;
    circle_icon_url?: string | null;
    round_id?: number | null;
    reply_count: number;
    reply_participants?: Array<{ id: number; username: string; avatar_url?: string | null }>;
  }>;
};

export type ProjectDetail = ProjectSummary & {
  can_edit: boolean;
  can_add_material: boolean;
  invitation_only?: boolean;
  entries: ProjectEntry[];
  own_draft_id?: number | null;
  viewer_participation: "owner" | "pending" | "accepted" | "declined" | null;
};

export type ProjectInput = {
  iconSymbol?: string;
  iconColor?: string;
  name: string;
  description?: string | null;
  roomIds?: number[];
  icon?: File | null;
  banner?: File | null;
  removeIcon?: boolean;
  removeBanner?: boolean;
};

export function fetchProject(client: ApiClient, projectId: string | number) {
  return client.get<ProjectDetail>(`/v1/projects/${projectId}`);
}

export type ProjectEntryPage = { entries: ProjectEntry[]; nextCursor: string | null };
export type ProjectCopyPage = { submissions: ProjectEntry["submissions"]; nextCursor: string | null };
export function fetchProjectCopyPage(client: Pick<ApiClient, "get">, projectId: string, entryId: string, cursor: string | null = null) {
  return client.get<ProjectCopyPage>(`/v1/projects/${encodeURIComponent(projectId)}/entries/${encodeURIComponent(entryId)}/copies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
}
export function fetchProjectEntryPage(client: Pick<ApiClient, "get">, projectId: string | number, cursor: string | null = null, entryId?: string) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (entryId) params.set("entry_id", entryId);
  const query = params.toString();
  return client.get<ProjectEntryPage>(`/v1/projects/${encodeURIComponent(String(projectId))}/entries${query ? `?${query}` : ""}`);
}

export function createProject(client: ApiClient, input: ProjectInput) {
  return createProjectRecord<ProjectDetail>(client, projectForm(input));
}

export function updateProject(client: ApiClient, projectId: string | number, input: ProjectInput) {
  return updateProjectRecord<ProjectDetail>(client, projectId, projectForm(input));
}

export function inviteProjectParticipant(client: ApiClient, projectId: string | number, username: string) {
  return client.post<ProjectDetail>(`/v1/projects/${projectId}/invitations`, { username });
}

export function respondToProjectInvitation(
  client: ApiClient,
  projectId: string | number,
  response: "accept" | "decline",
) {
  return client.post<ProjectDetail | { id: number; viewer_participation: "declined" }>(`/v1/projects/${projectId}/participation/${response}`);
}

export function associateEntryProject(client: ApiClient, postId: string | number, projectId: string | number | null) {
  return client.patch<{ id: number; project_id: number | null }>(`/v1/entries/${postId}/project`, {
    project_id: projectId,
  });
}

function projectForm(input: ProjectInput) {
  if (input.icon) assertImageFile(input.icon);
  if (input.banner) assertImageFile(input.banner);
  const form = projectFields(input);
  if (input.icon) form.append("project[icon]", input.icon);
  if (input.banner) form.append("project[banner]", input.banner);
  return form;
}

export type ProjectEntryInput = {
  expected_revision?: number;
  content?: TiptapDoc;
  format?: EntryFormat;
  format_data?: EntryFormatData | null;
  intent?: string | null;
  question?: string | null;
  lyrics?: string | null;
  save?: boolean;
};

export type ShareProjectEntryInput = {
  source_revision?: string;
  selected_unit_ids?: string[];
  room_statement?: string;
  request_key?: string;
  creation_origin?: "round_activity_cover" | "round_activity_response";
  room_id: number;
  round_id?: number;
};

export function createProjectEntry(client: ApiClient, projectId: string | number, input?: { fresh?: boolean; request_key?: string }) {
  return client.post<ProjectEntry>(`/v1/projects/${projectId}/entries`, input);
}

export function fetchProjectEntry(client: ApiClient, projectId: string | number, entryId: string | number) {
  return client.get<ProjectEntry>(`/v1/projects/${projectId}/entries/${entryId}`);
}

export function updateProjectEntry(client: ApiClient, projectId: string | number, entryId: string | number, input: ProjectEntryInput) {
  return client.patch<ProjectEntry>(`/v1/projects/${projectId}/entries/${entryId}`, input);
}

export function fetchEntryShareManifest(client: ApiClient, projectId: string | number, entryId: string | number, roomId: string | number) {
  return client.get<EntryShareManifest>(`/v1/projects/${projectId}/entries/${entryId}/share-selection?room_id=${encodeURIComponent(String(roomId))}`);
}

export function shareProjectEntry(client: ApiClient, projectId: string | number, entryId: string | number, input: ShareProjectEntryInput) {
  return client.post<{ entry_id: number; path: string }>(`/v1/projects/${projectId}/entries/${entryId}/share-draft`, input);
}

export function keepProjectFeedback(client: ApiClient, projectId: string | number, replyId: string | number) {
  return client.post<ProjectEntry & { already_saved: boolean }>(`/v1/projects/${projectId}/keep`, { reply_id: replyId });
}

export function keepProjectChatMessage(client: ApiClient, projectId: string | number, messageId: string | number) {
  return keepChatMessage<ProjectEntry>(client, projectId, messageId);
}

export function removeProjectParticipant(client: ApiClient, projectId: string | number, userId: string | number) {
  return client.delete<ProjectDetail>(`/v1/projects/${projectId}/participants/${userId}`);
}

export type PreparedEntryShare = { entry_id: number; room_id: number; round_id?: number; creation_origin?: ShareProjectEntryInput["creation_origin"] };
export async function fetchPreparedEntryShare(client: ApiClient, project: string, entry: string, requestKey: string) {
  // Nest may serialize no prepared copy as an empty response. Cache that
  // resolved absence so a recovery recheck does not remount the share editor.
  return (await client.get<PreparedEntryShare | null>(`/v1/projects/${project}/entries/${entry}/share-request/${encodeURIComponent(requestKey)}`)) ?? null;
}


export function moveProjectEntry(client: ApiClient, projectId: string, entryId: number, destination: number, revision: number) {
  return client.patch<{ id: number; project_id: number }>(`/v1/projects/${projectId}/entries/${entryId}/project`, { project_id: destination, expected_revision: revision });
}
export function deleteProjectEntry(client: ApiClient, projectId: string, entryId: number, revision: number) {
  return client.delete<{ id: number; project_id: null }>(`/v1/projects/${projectId}/entries/${entryId}?revision=${revision}`);
}
