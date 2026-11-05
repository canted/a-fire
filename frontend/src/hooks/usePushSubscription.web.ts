import { getMetaContent } from "../lib/browserMeta";
import { useMemo } from "react";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import { createBrowserPushSubscription } from "../lib/browserPushSubscription";
import { client } from "../lib/api";
import { useSession } from "./useSession";
export function usePushSubscription() {
  const session = useSession();
  const controller = useMemo(
    () =>
      createBrowserPushSubscription(
        client,
        getMetaContent("vapid-public-key") ||
          process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY,
      ),
    [],
  );
  const key = ["browser-push", session.epoch];
  const query = useSWR(key, () => controller.getStatus());
  const update = useSWRMutation(
    key,
    async (_, { arg }: { arg: boolean }) => {
      if (!arg) {
        await controller.unsubscribe();
        return;
      }
      const result = await controller.requestPermissionAndSubscribe();
      if (result === "missing-key") throw new Error("Push key is missing.");
      if (result === "unsupported")
        throw new Error("Push notifications are not supported on this device.");
      if (result === "denied")
        throw new Error("Notifications are blocked in your device settings.");
    },
    {
      populateCache: false,
      onSuccess: () => {
        void query.mutate();
      },
      onError: () => {
        void query.mutate();
      },
    },
  );
  return { supportedPlatform: true, query, update };
}
