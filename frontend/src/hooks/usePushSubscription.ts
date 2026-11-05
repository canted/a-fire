import type { PushStatus } from "../lib/browserPushSubscription";
/** Native notification registration remains a later product-integration boundary. */
export function usePushSubscription() {
  return {
    supportedPlatform: false,
    query: {
      data: { permission: "unsupported", subscribed: false } as PushStatus,
      isLoading: false,
      error: undefined as Error | undefined,
    },
    update: {
      isMutating: false,
      error: undefined as Error | undefined,
      trigger: async (_enabled: boolean) => {},
    },
  };
}
