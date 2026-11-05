import { ApiError } from "../lib/api/transport";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import {
  fetchNoteTree,
  prependNoteContentBlocks,
  fetchNote,
  createNote,
  deleteNote,
  updateNote,
  saveNoteContent,
} from "../lib/api/notes";
import { fetchRoom } from "../lib/api/rooms";
import { fetchMemberships } from "../lib/api/profile";
import {
  mergeNoteMutation,
  mergeNoteUpdate,
  subscribeToNote,
} from "../lib/noteSubscription";
import type { TiptapDoc } from "../lib/tiptap";
import { cable } from "../lib/cable";
import { client } from "../lib/api";
import { createReflection, type EntryShow } from "../lib/api/entries";
export function useRoomNotes(room: string) {
  const roomDetails = useSWR(
    room ? ["managed-room", room] : null,
    () => fetchRoom(client, room),
    { refreshInterval: 15000 },
  );
  const canView =
    !roomDetails.error &&
    roomDetails.data?.access?.kind === "member" &&
    roomDetails.data.access.can_view_notes;
  const tree = useSWR(canView ? ["page-tree", room] : null, () =>
    fetchNoteTree(client, room),
  );
  const denied = [roomDetails.error, tree.error].some(
    (error) =>
      error instanceof ApiError && [401, 403, 404].includes(error.status),
  );
  const allowed = canView && !denied;
  const create = useSWRMutation(
    ["note-create", room],
    async (_, { arg }: { arg: { title?: string; parent?: number } }) => {
      if (!allowed)
        throw new Error("You no longer have permission to create Notes here.");
      const result = await createNote(client, room, arg.title, arg.parent, {
        insertParentLink: Boolean(arg.parent),
      });
      await tree.mutate().catch(() => {});
      return result;
    },
  );
  const remove = useSWRMutation(
    ["note-tree-remove", room],
    async (_, { arg }: { arg: number }) => {
      if (!allowed)
        throw new Error("You no longer have permission to change Notes here.");
      await deleteNote(client, arg);
      await tree.mutate().catch(() => {});
    },
  );
  return { room: roomDetails, allowed, denied, tree, create, remove };
}

/** Save an authorized Room copy through the server's existing Note reflection owner. */
export function useEntryNoteSave(post?: EntryShow) {
  const notes = useRoomNotes(post?.room_id ? String(post.room_id) : "");
  const { mutate } = useSWRConfig();
  const available = post?.status === "published" && notes.allowed;
  const save = useSWRMutation(["entry-note-save", post?.id], async (_, { arg }: { arg: number }) => {
    if (!available || !post) throw new Error("You no longer have permission to save this to a Note.");
    await createReflection(client, { type: "post", id: post.id }, arg);
    await mutate(key => Array.isArray(key) && (
      (key[0] === "page" && String(key[1]) === String(arg)) ||
      (key[0] === "post" && String(key[1]) === String(post.id))
    ));
  });
  return { ...notes, available, save };
}
export function useNote(id: string) {
  const { mutate } = useSWRConfig();
  const metadataQueue = useRef<Promise<unknown>>(Promise.resolve());
  const query = useSWR(["page", id], () => fetchNote(client, id), {
    refreshInterval: 30000,
  });
  const identity = useSWR("memberships", () => fetchMemberships(client));
  useEffect(() => {
    const subscription = subscribeToNote(
      cable.getCableConsumer(),
      id,
      identity.data?.user.id,
      (payload) => {
        void query.mutate((previous) => mergeNoteUpdate(previous, payload), {
          revalidate: false,
        });
      },
      () => {
        void query.mutate().catch(() => {});
      },
    );
    return () => subscription?.unsubscribe();
  }, [id, identity.data?.user.id, query.mutate]);
  const meta = useSWRMutation(
    ["note-meta", id],
    async (
      _,
      { arg }: { arg: { title?: string | null; icon?: string | null } },
    ) => {
      // Autosave, explicit Save and navigation can overlap. Preserve user edit order.
      const request = metadataQueue.current
        .catch(() => {})
        .then(() => updateNote(client, id, arg));
      metadataQueue.current = request;
      const note = await request;
      await query.mutate(
        (previous) => mergeNoteMutation(previous, note, "meta"),
        { revalidate: false },
      );
      void mutate((key) => Array.isArray(key) && key[0] === "page-tree").catch(
        () => {},
      );
      return note;
    },
  );
  const content = useSWRMutation(
    ["note-content", id],
    async (_, { arg }: { arg: { content: TiptapDoc; version: number } }) => {
      const note = await saveNoteContent(client, id, arg.content, arg.version);
      await query.mutate(
        (previous) => mergeNoteMutation(previous, note, "content"),
        { revalidate: false },
      );
      return note;
    },
  );
  const remove = useSWRMutation(["note-remove", id], async () => {
    await metadataQueue.current;
    await deleteNote(client, id);
    await query.mutate(undefined, { revalidate: false });
    void mutate((key) => Array.isArray(key) && key[0] === "page-tree").catch(
      () => {},
    );
  });
  const child = useSWRMutation(["note-child", id], async () => {
    const room = query.data?.room_id;
    if (query.error || !room)
      throw new Error(
        "This Note is unavailable. Reopen it before creating a child.",
      );
    const result = await createNote(client, room, undefined, id, {
      insertParentLink: true,
    });
    await query.mutate().catch(() => {});
    void mutate((key) => Array.isArray(key) && key[0] === "page-tree").catch(
      () => {},
    );
    return result;
  });
  return { query, meta, content, remove, child };
}

/** Target writes remain authorized by the server; source deletion follows acknowledgment. */
export function useNoteBlockTransfer(
  room: string | number | null | undefined,
  enabled: boolean,
) {
  const { mutate } = useSWRConfig();
  const tree = useSWR(
    enabled && room ? ["page-tree", String(room)] : null,
    () => fetchNoteTree(client, room!),
  );
  const copy = useSWRMutation(
    ["note-transfer", room],
    async (
      _,
      {
        arg,
      }: { arg: { target: number; blocks: NonNullable<TiptapDoc["content"]> } },
    ) => {
      const note = await prependNoteContentBlocks(
        client,
        arg.target,
        arg.blocks,
      );
      await mutate(["page", String(arg.target)], note, { revalidate: false });
      return note;
    },
  );
  return { tree, copy };
}

/** A creation URL allocates once per visit, including effect replay. */
export function useNewNoteRoute(room: string) {
  const notes = useRoomNotes(room);
  const request = useRef<{
    room: string;
    promise: ReturnType<typeof notes.create.trigger>;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    room: string;
    id?: number;
    error?: string;
  }>();
  const trigger = notes.create.trigger;
  useEffect(() => {
    if (!notes.allowed) return;
    let current = true;
    if (!request.current || request.current.room !== room)
      request.current = { room, promise: trigger({}) };
    void request.current.promise
      .then((note) => {
        if (!note)
          throw new Error(
            "Could not confirm the new Note. Return to Notes before trying again.",
          );
        if (current) setResult({ room, id: note.id });
      })
      .catch((reason) => {
        if (current)
          setResult({
            room,
            error:
              reason instanceof Error
                ? reason.message
                : "Could not create a note.",
          });
      });
    return () => {
      current = false;
    };
  }, [room, notes.allowed, trigger, attempt]);
  return {
    room: notes.room,
    allowed: notes.allowed,
    denied: notes.denied,
    id: result?.room === room ? result.id : undefined,
    error: result?.room === room ? result.error : undefined,
    retry() {
      request.current = null;
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}
