import type { RoomEntryContext } from "../../contracts/sharedEntry";
import type { SessionTransport } from "./transport";
type ApiClient = Pick<SessionTransport, "get" | "post" | "patch" | "delete" | "put">;
import type { TiptapDoc } from "../tiptap";
import type { EntryFormat, EntryFormatData } from "../../contracts/entryFormats";

export type WallSummary = { id: string; roundId: string; roomId: string; title: string; description: string | null; publishedAt: string; presented: boolean; entryCount: number };
export type WallEntry = RoomEntryContext & { id: string; entryId: string | null; authorName: string; authorAvatarUrl: string | null; responseCount: number; responseParticipants: Array<{ id: number; username: string; avatar_url?: string | null }>; available: boolean; content: TiptapDoc | null; format: EntryFormat; formatData: EntryFormatData | null };
export type WallDetail = Omit<WallSummary, "presented" | "entryCount"> & { templateKey: string | null; entries: WallEntry[]; previousWallId?: string | null; nextWallId?: string | null };
export const fetchRoomWalls = (client: ApiClient, roomId: string) => client.get<{ walls: WallSummary[]; nextCursor?: string | null }>(`/v1/rooms/${roomId}/walls?cursor=`);
export const fetchWall = (client: ApiClient, wallId: string) => client.get<WallDetail>(`/v1/walls/${wallId}`);
export const presentWall = (client: ApiClient, wallId: string) => client.post<{ wallId: string; presented: true }>(`/v1/walls/${wallId}/presentation`);
