import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import {
  fetchNotificationPreferences,
  updateNotificationPreference,
  type UpdatePayload,
} from "../lib/api/notificationPreferences";
import { client } from "../lib/api";
export function useNotificationPreferences() {
  const query = useSWR(["notification-preferences"], () =>
    fetchNotificationPreferences(client),
  );
  const update = useSWRMutation(
    ["notification-preferences"],
    (_key, { arg }: { arg: UpdatePayload }) =>
      updateNotificationPreference(client, arg),
    {
      populateCache: false,
      onSuccess: (updated) => {
        void query.mutate((previous) =>
          previous?.map((item) =>
            item.roomId === updated.roomId ? updated : item,
          ),
        );
      },
    },
  );
  return { query, update };
}
