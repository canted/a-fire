import { useMemo, useState } from 'react';
import { SWRConfig, unstable_serialize } from 'swr';
import { RoomFlow, RoomScreen, type RoomRouteParams } from './RoomScreen';
import { StoryRouterProvider } from '../../../.storybook/routerFixture';
import type { LiveRoomPage, RoomMessage } from '../../lib/api/room';
import type { RoomPayload } from "../../lib/api/rooms";
import { normalizeRoomReplySettings } from '../../lib/feedback';

export default { title: 'Expo/Rooms/Integrated Chat', component: RoomScreen };
const messages: RoomMessage[] = Array.from({ length: 36 }, (_, index) => ({
  id: index + 1, kind: 'message', client_nonce: null,
  body: index % 5 === 0 ? 'I am keeping this part unfinished for now. The quiet space makes the next change easier to see. What do you notice when you come back to it?' : `Studio note ${index + 1}: keeping a little room for the next attempt.`,
  created_at: `2026-10-28T12:${String(index).padStart(2, '0')}:00Z`,
  author: { id: index % 3 === 0 ? 1 : 2, display_username: index % 3 === 0 ? 'Alex' : 'Maya' }, masked_author: null,
}));
const roomDetails: RoomPayload = { id: 101, name: 'Small hours studio', owner_id: 2, porosity: 'closed',
  access: { kind: 'member', can_manage: false, can_create_adjacent_room: false, can_view_notes: true, can_write_wall: true, can_participate_rounds: true },
};
function Fixture({ target, home = false, visitor = false, daily = false }: { target?: string; home?: boolean; visitor?: boolean; daily?: boolean }) {
  const [cache] = useState(() => new Map());
  const [open, setOpen] = useState(!home);
  const [params, setParams] = useState<RoomRouteParams>(target ? { message: target } : {});
  const router = useMemo(() => ({
    push: (path: string) => { if (path === '/app/rooms/101/chat') setOpen(true); else throw new Error(`Navigation unavailable in preview: ${path}`); },
    replace: (path: string) => { if (path === '/app/rooms/101') setOpen(false); else throw new Error(`Navigation unavailable in preview: ${path}`); },
    back: () => setOpen(false), canGoBack: () => true,
    setParams: (patch: Record<string, unknown>) => setParams(previous => ({ ...previous, ...patch })),
  }), []);
  const dailyMessages = useMemo<RoomMessage[]>(() => Array.from({ length: 15 }, (_, index) => {
    const daysAgo = 14 - index;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(12, 0, 0, 0);
    return { id: index + 1, kind: "message", client_nonce: null,
      body: `${daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`}: ${[
        "I recorded a quieter version of the opening.",
        "The space between those two phrases is working.",
        "Leaving this here to return to with fresh ears.",
      ][index % 3]}`,
      created_at: date.toISOString(), masked_author: null,
      author: { id: index % 2 + 1, display_username: index % 2 ? "Maya" : "Alex" } };
  }), []);
  const fixtureMessages = daily ? dailyMessages : messages;
  const access = visitor ? 'visitor' : 'member';
  const live: LiveRoomPage = { messages: visitor ? fixtureMessages.slice(-10) : fixtureMessages, next_cursor: null, viewer_user_id: 1, liveStartId: 1, historyCursor: null,
    viewer_access: { kind: access, can_send: !visitor, can_paginate: !visitor, history_limit: visitor ? 10 : null },
  };
  const roomDetailsForAccess = { ...roomDetails, access: { ...roomDetails.access!, kind: access, can_write_wall: !visitor, can_participate_rounds: !visitor } };
  const fallback = Object.fromEntries([
    [unstable_serialize(['room', '101']), live],
    ['rooms', { rooms: [roomDetailsForAccess] }],
    [unstable_serialize(['room', '101', access]), roomDetailsForAccess],
    [unstable_serialize(['managed-room', '101']), roomDetailsForAccess],
    [unstable_serialize(['board-activities', '101', access]), { activeRound: null, nextRound: null, recentRounds: [] }],
    [unstable_serialize(['board', '101']), { id: '101', name: 'Studio', squares: [], replySettings: normalizeRoomReplySettings() }],
    [unstable_serialize(['room-members', '101', access]), { members: [{ id: 1, user_id: 1, display_username: 'Alex', }, { id: 2, user_id: 2, display_username: 'Maya', }] }],
    [unstable_serialize(['room-adjacent-rooms', '101', access]), { parent: null, adjacent_rooms: [], can_create: false }],
    [unstable_serialize(['room-introduction-pairs', '101', access]), { pairs: [] }],
    [unstable_serialize(['room-walls', '101', access]), { walls: [] }],
    ['memberships', { user: { id: 1, username: 'Alex' }, memberships: [] }],
  ]);
  return <SWRConfig value={{ provider: () => cache, fallback, isPaused: () => true, revalidateOnMount: false, revalidateOnFocus: false, revalidateOnReconnect: false }}>
    <StoryRouterProvider router={router}><RoomFlow id="101" covered={false} chatOpen={open} routeParams={params} /></StoryRouterProvider>
  </SWRConfig>;
}
export const ReadingAndTyping = () => <Fixture />;
export const OpenFromHome = () => <Fixture home />;
export const MessageLinkArrival = () => <Fixture target="12" />;
export const MissingMessage = () => <Fixture target="999" />;
export const VisitorWindow = () => <Fixture visitor />;

export const FifteenDays = () => <Fixture daily target="8" />;
