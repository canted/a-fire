import { useRoomSubscription } from "./useRoomSubscription";
import { useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { fetchRoom, fetchRoomMembers } from "../lib/api/rooms";
import {
  fetchRoomRounds,
  fetchRound,
  createRoomRound,
  updateRound,
  startRound,
  archiveRound,
  updateRoundParticipation,
  withdrawRoundParticipation,
  chooseRoundCover,
  removeRoundArtifact,
  remindForCurrentRoundPhase,
  remindRoundParticipantToSubmit,
  type RoundPayload,
  type RoundRole,
} from "../lib/api/rounds";
import { client } from "../lib/api";
export function useRoomRounds(room: string, enabled = true, loadRounds = true) {
  const roomQuery = useSWR(
    enabled ? ["managed-room", room] : null,
    () => fetchRoom(client, room),
    { refreshInterval: 15000 },
  );
  const rounds = useSWR(
    enabled && loadRounds && roomQuery.data && !roomQuery.error
      ? ["room-rounds", room, roomQuery.data.access?.kind]
      : null,
    () => fetchRoomRounds(client, room),
    { refreshInterval: 15000 },
  );
  useRoomSubscription(enabled && roomQuery.data && !roomQuery.error ? room : "", async () => {});
  return { room: roomQuery, rounds };
}
export function useRoundDetail(id?: string) {
  return useSWR(
    id ? ["activity", id] : null,
    () => fetchRound(client, id!),
    { refreshInterval: 15000 },
  );
}
type RoundAction =
  | { kind: "save"; payload: RoundPayload }
  | { kind: "start" | "archive" | "withdraw" | "remind" }
  | { kind: "participate"; role: RoundRole }
  | { kind: "choose"; cover: string }
  | { kind: "remove"; artifact: string; note: string; notify: boolean }
  | { kind: "remind-person"; user: string };
export function useRound(id?: string, roomId?: string) {
  const detail = useRoundDetail(id);
  const resolvedRoomId = detail.data?.round.roomId ?? roomId;
  useRoomSubscription(resolvedRoomId ? String(resolvedRoomId) : "", async () => {}, detail.mutate);
  const roomQuery = useSWR(
    resolvedRoomId ? ["managed-room", String(resolvedRoomId)] : null,
    () => fetchRoom(client, String(resolvedRoomId)),
    { refreshInterval: 15000 },
  );
  const members = useSWR(resolvedRoomId && !roomQuery.error && roomQuery.data?.access?.can_manage ? ["managed-room-members", String(resolvedRoomId)] : null,
    () => fetchRoomMembers(client, String(resolvedRoomId)));
  const { mutate } = useSWRConfig();
  const flight = useRef<Promise<unknown> | null>(null);
  const action = useSWRMutation(
    ["round-action", resolvedRoomId, id],
    async (_, { arg }: { arg: RoundAction }) => {
      let result: unknown;
      if (arg.kind === "save") {
        if (!id && !resolvedRoomId) throw new Error("Open a Room to create a Round.");
        result = id
          ? await updateRound(client, id, arg.payload)
          : await createRoomRound(client, String(resolvedRoomId), arg.payload);
      }
      else {
        if (!id) throw new Error("Open a Round first.");
        switch (arg.kind) {
          case "start":
            result = await startRound(client, id);
            break;
          case "archive":
            result = await archiveRound(client, id);
            break;
          case "participate":
            result = await updateRoundParticipation(client, id, arg.role);
            break;
          case "withdraw":
            result = await withdrawRoundParticipation(client, id);
            break;
          case "choose":
            result = await chooseRoundCover(client, id, arg.cover);
            break;
          case "remove":
            result = await removeRoundArtifact(client, id, arg.artifact, {
              note: arg.note,
              sendPushNotification: arg.notify,
            });
            break;
          case "remind":
            result = await remindForCurrentRoundPhase(client, id);
            break;
          case "remind-person":
            result = await remindRoundParticipantToSubmit(
              client,
              id,
              arg.user,
            );
            break;
        }
      }
      await Promise.allSettled([
        detail.mutate(),
        mutate(
          (key) =>
            Array.isArray(key) &&
            ["room-rounds", "room-walls", "room", "home"].includes(
              String(key[0]),
            ),
        ),
      ]);
      return result;
    },
  );
  return {
    members,
    canManage: !detail.error && !roomQuery.error && Boolean(roomQuery.data?.access?.can_manage),
    detail,
    room: roomQuery,
    busy: action.isMutating,
    run(arg: RoundAction) {
      if (flight.current) return flight.current;
      const request = action.trigger(arg).finally(() => {
        flight.current = null;
      });
      flight.current = request;
      return request;
    },
  };
}
