import type { Consumer } from './createCable';

export type RoomConnectionStatus = 'connecting' | 'syncing' | 'live' | 'reconnecting' | 'offline';
type Event = { room_id: string | number; type: string; present_user_ids?: number[] };
/** Join before fetching; serialize catch-up so events arriving during a request aren't lost. */
export function subscribeToRoom(options: {
  id: string | number;
  consumer: Consumer;
  refresh: () => Promise<unknown>;
  refreshHistory: () => void;
  changed: (event: Event) => void;
  status: (status: RoomConnectionStatus) => void;
  online: () => boolean;
}) {
  let active = true;
  let joined = false;
  let joinedBefore = false;
  let refreshing = false;
  let dirty = false;
  let generation = 0;
  const set = (value: RoomConnectionStatus) => { if (active) options.status(value); };
  const disconnected = () => {
    joined = false; generation++;
    set(options.online() ? 'reconnecting' : 'offline');
  };
  const offline = () => {
    joined = false; generation++;
    set('offline');
  };
  const refresh = async () => {
    dirty = true;
    if (refreshing) return;
    refreshing = true;
    try {
      while (active && dirty) {
        dirty = false;
        const started = generation;
        await options.refresh();
        if (active && joined && started === generation && !dirty) set('live');
      }
    } catch { set(options.online() ? 'reconnecting' : 'offline'); }
    finally { refreshing = false; }
  };
  set(options.online() ? 'connecting' : 'offline');
  const subscription = options.consumer.subscriptions.create<Event>({ channel: 'ChatChannel', id: options.id }, {
    connected: () => {
      joined = true; generation++; set('syncing'); void refresh();
      if (joinedBefore) options.refreshHistory();
      joinedBefore = true;
    },
    disconnected,
    received: event => {
      if (!event || String(event.room_id) !== String(options.id)) return;
      options.changed(event);
      if (event.type === 'presence') return;
      void refresh();
      if (event.type !== 'message_created') options.refreshHistory();
    },
  });
  return {
    refresh,
    disconnected,
    offline,
    unsubscribe() { active = false; subscription.unsubscribe(); },
  };
}
