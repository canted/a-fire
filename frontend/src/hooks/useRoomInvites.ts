import { useRef } from "react";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import {
  createInvite,
  fetchInvites,
  fetchInviteSuggestions,
  type CreateInvitePayload,
} from "../lib/api/invites";
import { client } from "../lib/api";
import { useManagedRoom } from "./useRoomManagement";
export function useRoomInvites(id: string, search: string) {
  const access = useManagedRoom(id);
  const list = useSWR(access.allowed ? ["room-invites", id] : null, () =>
    fetchInvites(client, { roomId: id }),
  );
  const suggestions = useSWR(
    access.allowed && search.trim()
      ? ["room-invite-suggestions", id, search.trim()]
      : null,
    () => fetchInviteSuggestions(client, id, search.trim()),
    { dedupingInterval: 300 },
  );
  const flight = useRef<Promise<unknown> | null>(null);
  const create = useSWRMutation(
    ["room-invite-create", id],
    async (_, { arg }: { arg: CreateInvitePayload }) => {
      if (!access.allowed)
        throw new Error(
          "You no longer have permission to invite people to this Room.",
        );
      const result = await createInvite(client, arg);
      await list.mutate().catch(() => {});
      return result;
    },
  );
  return {
    ...access,
    list,
    suggestions,
    busy: create.isMutating,
    send(arg: CreateInvitePayload) {
      if (flight.current) return flight.current;
      const request = create.trigger(arg).finally(() => {
        flight.current = null;
      });
      flight.current = request;
      return request;
    },
  };
}
