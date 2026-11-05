import { useCallback, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import useSWRMutation from "swr/mutation";
import { createChatReadReceipts } from "../lib/chatReadReceipts";
import { client } from "../lib/api";

export function useRoomReadReceipts(
  id: string,
  thread?: string,
  kind: "chat" | "post" | "post-replies" = "chat",
) {
  const { mutate } = useSWRConfig();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { trigger } = useSWRMutation(
    ["room-seen", id, thread, kind],
    async (_, { arg }: { arg: number[] }) => {
      if (kind !== "chat")
        await client.post(
          `/v1/entries/${id}/seen`,
          kind === "post" ? { postVisible: true } : { replyIds: arg },
        );
      else
        await client.post(
          thread
            ? `/v2/rooms/${id}/chat/messages/${thread}/replies/seen`
            : `/v2/rooms/${id}/chat/messages/seen`,
          thread ? { replyIds: arg } : { messageIds: arg },
        );
      // The final exposure batch still reaches the server when leaving a route.
      // Its old SWR provider may already be disposed after browser traversal.
      if (mounted.current) await mutate(
        (key) =>
          Array.isArray(key) &&
          ["home", "unseen", "inbox"].includes(String(key[0])),
      );
    },
  );
  const receipts = useRef<ReturnType<typeof createChatReadReceipts> | null>(
    null,
  );
  useEffect(() => {
    const batch = createChatReadReceipts((ids) => trigger(ids));
    receipts.current = batch;
    return () => {
      receipts.current = null;
      batch.dispose();
    };
  }, [id, thread, kind, trigger]);
  return useCallback(
    (message: number) => receipts.current?.enqueue(message),
    [],
  );
}
