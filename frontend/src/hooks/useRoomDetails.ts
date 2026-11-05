import { useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  fetchRoom,
  fetchRoomAncestry,
  fetchRoomMembers,
  fetchSideRooms,
  createSideRoom,
  joinRoom,
  requestRoomKnock,
  createRoomMemberInvitation,
  suggestRoomKnock,
  type SideRoom,
} from "../lib/api/rooms";
import {
  createIntroduction,
  fetchRoomIntroductionPairs,
} from "../lib/api/introductions";
import { fetchMemberships } from "../lib/api/profile";
import { client } from "../lib/api";

export function useRoomDetails(
  id: string,
  active: boolean,
  access?: "member" | "visitor" | "denied",
) {
  const identity = useSWR(
    active && access && access !== "denied" ? "memberships" : null,
    () => fetchMemberships(client),
  );
  const roomDetails = useSWR(
    !access || access === "denied" ? null : ["room", id, access],
    () => fetchRoom(client, id),
  );
  const member = roomDetails.data?.access?.kind === "member";
  const members = useSWR(
    active && access && access !== "denied"
      ? ["room-members", id, access]
      : null,
    () => fetchRoomMembers(client, id),
  );
  const sides = useSWR(
    !access || access === "denied" ? null : ["room-adjacent-rooms", id, access],
    () => fetchSideRooms(client, id),
  );
  const pairs = useSWR(
    active && member ? ["room-introduction-pairs", id, access] : null,
    () => fetchRoomIntroductionPairs(client, id),
  );
  const ancestry = useSWR(
    active && roomDetails.data?.parent
      ? ["room-ancestry", id, roomDetails.data.parent.id, access]
      : null,
    () => fetchRoomAncestry(client, roomDetails.data!),
  );
  const { mutate } = useSWRConfig();
  const refresh = () =>
    mutate(
      (key) =>
        ["rooms", "home"].includes(String(key)) ||
        (Array.isArray(key) &&
          [
            "room",
            "room-members",
            "room-adjacent-rooms",
            "room-introduction-pairs",
          ].includes(String(key[0]))),
    );
  type Action =
    | { kind: "create"; users: number[] }
    | { kind: "activate"; room: SideRoom }
    | { kind: "carry"; room: SideRoom; user: number }
    | { kind: "introduce"; users: number[]; note: string };
  const flight = useRef<Promise<{
    destination?: number;
    message?: string;
  }> | null>(null);
  const action = useSWRMutation(
    ["room-details-action", id],
    async (_, { arg }: { arg: Action }) => {
      let result: { destination?: number; message?: string } = {};
      if (arg.kind === "create") {
        const created = await createSideRoom(client, id, {
          user_ids: arg.users,
        });
        result = { destination: created.id };
      }
      if (arg.kind === "activate") {
        const room = arg.room;
        if (room.actions.enter) result = { destination: room.id };
        else if (room.actions.knock) {
          const response = await requestRoomKnock(client, room.id);
          result =
            response.state === "admitted"
              ? { destination: room.id }
              : { message: "Your knock has been sent." };
        } else if (room.actions.join || room.actions.request_join) {
          const response = await joinRoom(client, room.id);
          result =
            response.state === "member"
              ? { destination: room.id }
              : { message: "Your request to join has been sent." };
        } else throw new Error("This Room is not available to enter.");
      }
      if (arg.kind === "carry") {
        if (arg.room.porosity === "closed" && arg.room.actions.suggest_knock) {
          await suggestRoomKnock(client, arg.room.id, arg.user);
          result = { message: "Suggestion to knock sent." };
        } else if (arg.room.porosity !== "closed" && arg.room.actions.invite) {
          await createRoomMemberInvitation(client, arg.room.id, arg.user);
          result = { message: "Room invitation sent." };
        } else throw new Error("You cannot invite this person to that Room.");
      }
      if (arg.kind === "introduce") {
        const response = await createIntroduction(client, {
          room_id: id,
          recipient_user_ids: arg.users,
          note: arg.note.trim(),
        });
        result = {
          message: response.existing
            ? "These people have already been introduced."
            : "Introduction sent.",
        };
      }
      void refresh().catch(() => {});
      return result;
    },
  );
  return {
    identity,
    room: roomDetails,
    members,
    sides,
    pairs,
    ancestry,
    action,
    refresh,
    submit(arg: Action) {
      if (flight.current) return flight.current;
      const pending = action.trigger(arg).finally(() => {
        flight.current = null;
      });
      flight.current = pending;
      return pending;
    },
  };
}
