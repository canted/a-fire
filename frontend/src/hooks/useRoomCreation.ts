import { useRef } from "react";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { roomFormData, createRoomRecord } from "../lib/api/rooms";
import { assertImageFile } from "../lib/imageFile";
import { appendPickedFile } from "../lib/chatFiles";
import type { ChatAttachment } from "../lib/chatComposition";
import { client } from "../lib/api";

export function useRoomCreation() {
  const { mutate } = useSWRConfig();
  const flight = useRef<ReturnType<typeof createRoomRecord> | null>(null);
  const mutation = useSWRMutation(
    "room-create",
    async (_, { arg }: { arg: { name: string; avatar?: ChatAttachment } }) => {
      const name = arg.name.trim();
      if (!name) throw new Error("Enter a Room name.");
      const form = roomFormData({ name });
      if (arg.avatar) {
        assertImageFile(arg.avatar);
        appendPickedFile(form, "room[avatar]", arg.avatar);
      }
      const room = await createRoomRecord(client, form);
      void mutate(
        (key) =>
          key === "rooms" ||
          key === "memberships" ||
          (Array.isArray(key) && key[0] === "home"),
      ).catch(() => {});
      return room;
    },
  );
  return {
    ...mutation,
    submit(input: { name: string; avatar?: ChatAttachment }) {
      if (flight.current) return flight.current;
      const pending = mutation.trigger(input).finally(() => {
        flight.current = null;
      });
      flight.current = pending;
      return pending;
    },
  };
}
