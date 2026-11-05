declare module "@rails/actioncable" {
  export type ChannelNameWithParams = string | Record<string, unknown>;

  export interface Subscription {
    unsubscribe(): void;
  }

  export interface Subscriptions {
    create(
      channel: ChannelNameWithParams,
      mixin?: {
        received?: (data: any) => void;
        connected?: () => void;
        disconnected?: () => void;
      },
    ): Subscription;
  }

  export interface Consumer {
    subscriptions: Subscriptions;
    disconnect(): void;
  }

  export function createConsumer(url?: string): Consumer;
}
