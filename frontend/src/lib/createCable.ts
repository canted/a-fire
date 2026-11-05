// Structural transport boundary keeps the two package graphs independent.
export type CableSocket = {
  connected: boolean;
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  connect(): void;
  disconnect(): void;
  removeAllListeners(): void;
};
type Socket = CableSocket;

export type CableOptions = {
  createSocket: (auth: (callback: (data: object) => void) => void) => Socket;
  getAccessToken: () => Promise<string | null>;
};

type SubscriptionParams = {
  channel: "EntryChannel" | "NoteChannel" | "NotificationChannel" | "ChatChannel";
  id?: string | number;
};

type SubscriptionHandlers<T> = {
  received: (payload: T) => void;
  connected?: () => void;
  disconnected?: () => void;
};

type Subscription = { unsubscribe: () => void };

export type Consumer = {
  subscriptions: {
    create: <T>(params: SubscriptionParams, handlers: SubscriptionHandlers<T>) => Subscription;
  };
};

export function createCable(options: CableOptions) {
let socket: Socket | null = null;
let consumer: Consumer | null = null;
const subscriptionCounts = new Map<string, number>();
const subscriptionParams = new Map<string, SubscriptionParams>();
const chatRooms = new Map<string, {
  ready: boolean;
  generation: number;
  timer?: ReturnType<typeof setTimeout>;
  handlers: Set<Pick<SubscriptionHandlers<unknown>, "connected" | "disconnected">>;
}>();

function subscribeRoom(client: Socket, params: SubscriptionParams) {
  if (params.channel !== "ChatChannel") { client.emit("subscribe", params); return; }
  const key = subscriptionKey(params);
  const room = chatRooms.get(key);
  if (!room || !client.connected) return;
  const generation = ++room.generation;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    if (chatRooms.get(key) !== room || room.generation !== generation) return;
    room.ready = false;
    room.handlers.forEach(handler => handler.disconnected?.());
    subscribeRoom(client, params);
  }, 10_000);
  client.emit("subscribe", params, (result: { subscribed?: boolean } | undefined) => {
    if (chatRooms.get(key) !== room || room.generation !== generation || !client.connected) return;
    if (!result?.subscribed) return; // Timeout retries failed/unsupported acknowledgements.
    clearTimeout(room.timer);
    if (room.ready) return; // Presence confirmation is not another connection.
    room.ready = true;
    room.handlers.forEach(handler => handler.connected?.());
  });
}


function subscriptionKey(params: SubscriptionParams) {
  return `${params.channel}:${params.id ?? ""}`;
}

function resubscribeActiveRooms(client: Socket) {
  subscriptionParams.forEach((params) => {
    subscribeRoom(client, params);
  });
}

function getSocket() {
  if (socket) return socket;

  socket = options.createSocket(callback => {
    void options.getAccessToken().then(token => callback(token ? { token } : {}))
      .catch(() => callback({}));
  });
  const disconnected = () => {
    chatRooms.forEach(room => {
      clearTimeout(room.timer);
      room.generation++;
      room.ready = false;
      room.handlers.forEach(handler => handler.disconnected?.());
    });
  };
  socket.on("disconnect", disconnected);
  socket.on("connect_error", disconnected);
  socket.on("connect", () => {
    resubscribeActiveRooms(socket!);
  });

  return socket;
}

function onCableConnect(handler: () => void): () => void {
  const client = getSocket();
  client.on("connect", handler);
  return () => {
    client.off("connect", handler);
  };
}

function ensureCableConnected(): void {
  const client = getSocket();
  if (!client.connected) {
    client.connect();
  }
}

function refreshChatPresence(roomId: string | number): void {
  const client = getSocket();
  if (!client.connected) return;
  client.emit("chat_presence", { id: roomId });
  // Reconfirm room membership too: a connected transport alone is insufficient.
  subscribeRoom(client, { channel: "ChatChannel", id: roomId });
}

function getCableConsumer(): Consumer {
  if (consumer) return consumer;
  const client = getSocket();

  consumer = {
    subscriptions: {
      create: (params, handlers) => {
        const key = subscriptionKey(params);
        const existingCount = subscriptionCounts.get(key) ?? 0;
        subscriptionCounts.set(key, existingCount + 1);
        subscriptionParams.set(key, params);
        const onMessage = (payload: unknown) => {
          handlers.received(payload as any);
        };
        let unsubscribed = false;

        client.on(params.channel, onMessage);
        if (params.channel === "ChatChannel") {
          const room = chatRooms.get(key) ?? { ready: false, generation: 0, handlers: new Set() };
          room.handlers.add(handlers);
          chatRooms.set(key, room);
          if (room.ready) queueMicrotask(() => { if (!unsubscribed) handlers.connected?.(); });
        }
        if (existingCount === 0) subscribeRoom(client, params);

        return {
          unsubscribe: () => {
            if (unsubscribed) return;
            unsubscribed = true;

            const room = chatRooms.get(key);
            room?.handlers.delete(handlers);
            const count = subscriptionCounts.get(key) ?? 0;
            if (count <= 1) {
              if (room) clearTimeout(room.timer);
              chatRooms.delete(key);
              subscriptionCounts.delete(key);
              subscriptionParams.delete(key);
              client.emit("unsubscribe", params);
            } else {
              subscriptionCounts.set(key, count - 1);
            }
            client.off(params.channel, onMessage);
          },
        };
      },
    },
  };

  return consumer;
}

function disconnect() {
  chatRooms.forEach(room => clearTimeout(room.timer));
  socket?.disconnect();
  socket?.removeAllListeners();
  socket = null;
  consumer = null;
  subscriptionCounts.clear();
  subscriptionParams.clear();
  chatRooms.clear();
}
return { onCableConnect, ensureCableConnected, refreshChatPresence, getCableConsumer, disconnect };
}
