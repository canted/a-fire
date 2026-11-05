import type { RoomConnectionStatus } from '../src/lib/roomSubscription';
/** Cached timelines exercise production reading; no socket or live-delivery claim. */
export function useRoomSubscription(): RoomConnectionStatus { return 'offline'; }
