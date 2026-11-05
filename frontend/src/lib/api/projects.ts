import type { SessionTransport } from "./transport";

export type ProjectPerson = {
  id: number;
  username: string;
};

export type ProjectSummary = {
  id: number;
  name: string;
  description?: string | null;
  owner: ProjectPerson;
  participants: ProjectPerson[];
  pending_participants: ProjectPerson[];
  rooms: Array<{ id: number; name?: string | null }>;
  icon_symbol?: string | null;
  icon_color?: string | null;
  icon_url?: string | null;
  banner_url?: string | null;
  banner_width?: number | null;
  banner_height?: number | null;
  updated_at: string;
  material_activity_at?: string | null;
  latest_material?: {
    id: number;
    added_at: string;
    intent: string | null;
    author: ProjectPerson;
  } | null;
  unread_feedback_count?: number;
  latest_unread_feedback?: {
    reply_id: number;
    entry_id: number;
    published_at: string;
    source_author_name: string;
    excerpt: string | null;
    room_name: string | null;
  } | null;
  viewer_participation?: "owner" | "pending" | "accepted" | "declined" | null;
};

export type ProjectListPage = { projects: ProjectSummary[]; nextCursor: string | null };
export function fetchProjectListPage(client: Pick<SessionTransport, 'get'>, targetRoomId?: string | number, cursor = '') {
  const query = new URLSearchParams({ cursor });
  if (targetRoomId) query.set("room_id", String(targetRoomId));
  return client.get<ProjectListPage>(`/v1/projects?${query}`);
}

/** Activity changes may move a Project between pages; retain one displayed row. */
export function projectListItems(pages: ProjectListPage[] | undefined) {
  return [...new Map((pages ?? []).flatMap(page => page.projects).map(project => [project.id, project])).values()];
}
export function eligibleSaveProjects(projects: ProjectSummary[]) {
  return projects.filter(project => project.viewer_participation === 'owner');
}
export function keepChatMessage<T = { id: number }>(client: Pick<SessionTransport, 'post'>, projectId: string | number, messageId: string | number) {
  return client.post<T>(`/v1/projects/${encodeURIComponent(projectId)}/keep`, { chat_message_id: messageId });
}

export type ProjectFields = { requestKey?: string; name: string; description?: string | null; iconSymbol?: string; iconColor?: string; roomIds?: number[]; removeIcon?: boolean; removeBanner?: boolean };
export function projectFields(input: ProjectFields) {
  const form = new FormData();
  if (input.requestKey) form.append("project[request_key]", input.requestKey);
  if (input.removeIcon) form.append('project[remove_icon]', 'true');
  if (input.removeBanner) form.append('project[remove_banner]', 'true');
  form.append('project[name]', input.name);
  if (input.description !== undefined) form.append('project[description]', input.description ?? '');
  if (input.iconSymbol) form.append('project[icon_symbol]', input.iconSymbol);
  if (input.iconColor) form.append('project[icon_color]', input.iconColor);
  input.roomIds?.forEach(id => form.append('project[room_ids][]', String(id)));
  return form;
}
export function createProjectRecord<T = ProjectSummary>(client: Pick<SessionTransport, 'post'>, form: FormData) {
  return client.post<T>('/v1/projects', form);
}

export function updateProjectRecord<T = ProjectSummary>(client: Pick<SessionTransport, 'patch'>, id: string | number, form: FormData) {
  return client.patch<T>(`/v1/projects/${id}`, form);
}
