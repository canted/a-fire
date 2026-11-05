import { describe, expect, it, vi } from 'vitest';
import { subscribeToRoom } from '../../../../frontend/src/lib/roomSubscription';
import type { Consumer } from '../../../../frontend/src/lib/createCable';

function fixture() {
  let handlers!: { connected?: () => void; disconnected?: () => void; received: (event: unknown) => void };
  const unsubscribe = vi.fn();
  const consumer = { subscriptions: { create: vi.fn((_params, callbacks) => { handlers = callbacks; return { unsubscribe }; }) } } as Consumer;
  const refresh = vi.fn().mockResolvedValue(undefined);
  const history = vi.fn(); const changed = vi.fn(); const status = vi.fn();
  const subscription = subscribeToRoom({ id: 7, consumer, refresh, refreshHistory: history, changed, status, online: () => true });
  return { handlers, refresh, history, changed, status, subscription, unsubscribe };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
describe('shared Room subscription', () => {
  it('does not claim live until membership is acknowledged and catch-up finishes', async () => {
    const f = fixture();
    expect(f.refresh).not.toHaveBeenCalled();
    let finish!: () => void;
    f.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    f.handlers.connected?.();
    expect(f.status).toHaveBeenLastCalledWith('syncing');
    f.handlers.disconnected?.(); finish(); await tick();
    expect(f.status).toHaveBeenLastCalledWith('reconnecting');
    f.handlers.connected?.(); await tick();
    expect(f.status).toHaveBeenLastCalledWith('live');
    expect(f.history).toHaveBeenCalledOnce();
    f.subscription.unsubscribe();
  });
  it('queues another catch-up for a burst during an in-flight snapshot, filters other Rooms, and refreshes edited history', async () => {
    const f = fixture(); let finish!: () => void;
    f.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    f.handlers.connected?.();
    f.handlers.received({ room_id: 8, type: 'message_created' });
    expect(f.changed).not.toHaveBeenCalled();
    f.handlers.received({ room_id: 7, type: 'message_created' });
    f.handlers.received({ room_id: 7, type: 'message_created' });
    expect(f.refresh).toHaveBeenCalledTimes(1);
    finish(); await tick();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.history).not.toHaveBeenCalled();
    f.handlers.received({ room_id: 7, type: 'message_updated' });
    expect(f.history).toHaveBeenCalledOnce();
    f.subscription.unsubscribe();
  });
  it('does not announce live after unmount and recovers a failed snapshot on the next event', async () => {
    const f = fixture(); f.refresh.mockRejectedValueOnce(new Error('offline'));
    f.handlers.connected?.(); await tick();
    expect(f.status).toHaveBeenLastCalledWith('reconnecting');
    f.handlers.received({ room_id: 7, type: 'message_created' }); await tick();
    expect(f.status).toHaveBeenLastCalledWith('live');
    let finish!: () => void;
    f.refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    f.handlers.connected?.(); f.subscription.unsubscribe();
    finish(); await tick();
    expect(f.status).toHaveBeenLastCalledWith('syncing');
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
});
