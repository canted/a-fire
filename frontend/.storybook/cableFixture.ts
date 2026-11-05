import type { Consumer } from '../src/lib/createCable';
/** Cached previews have no realtime source; subscriptions never open a socket. */
const consumer: Consumer = { subscriptions: { create: () => ({ unsubscribe() {} }) } };
export const cable = {
  getCableConsumer: () => consumer,
  onCableConnect: () => () => {},
  ensureCableConnected() {},
  refreshChatPresence() {},
  disconnect() {},
};
