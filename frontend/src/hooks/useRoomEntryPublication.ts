import { useEffect, useRef, useState } from "react";
import { useProjectShare } from "./useProjectShare";
import type { PreparedEntryShare, ShareProjectEntryInput } from "../lib/api/projectEntries";
import { useRoundDraftCompletion } from "./useRoundContribution";
import { useEntryDraft } from "./useEntryDraft";

type PublishedCopy = { entryId: number; path: string };

/** Save the full private source through the editor before requesting its Room copy. */
export function useRoomEntryPublication(project: string, entry: number, room: string, requestKey?: string, prepared?: PreparedEntryShare) {
  const sharing = useProjectShare(project, entry, room);
  const [request, setRequest] = useState<ShareProjectEntryInput | undefined>(prepared);
  const [copy, setCopy] = useState<string | undefined>(prepared ? String(prepared.entry_id) : undefined);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const publication = useEntryDraft({ existing: copy });
  const completion = useRoundDraftCompletion(request?.round_id, request?.creation_origin === "round_activity_cover" ? "cover" : request?.creation_origin === "round_activity_response" ? "response" : "submission", publication.draft.data?.id, () => publication.submit(async () => {}));
  const pending = useRef<{ resolve(value: PublishedCopy): void; reject(error: unknown): void } | undefined>(undefined);
  const publishing = useRef(false);
  const flight = useRef<Promise<PublishedCopy> | null>(null);
  useEffect(() => {
    if (!pending.current || publishing.current) return;
    if (publication.draft.error) {
      pending.current.reject(publication.draft.error);
      pending.current = undefined;
    } else if (publication.draft.data) {
      publishing.current = true;
      void completion.trigger().then(() => pending.current?.resolve({ entryId: Number(copy), path: `/app/entries/${copy}` }), error => pending.current?.reject(error)).finally(() => {
        pending.current = undefined;
        publishing.current = false;
      });
    }
  }, [publication.draft.data, publication.draft.error, completion, attempt]);
  async function publish(input?: ShareProjectEntryInput) {
    if (flight.current) return flight.current;
    setBusy(true);
    const promise = (async () => {
      if (!copy) setRequest(input);
      const destination = copy || String((await sharing.share.trigger({ ...(input || { room_id: Number(room) }), ...(requestKey ? { request_key: requestKey } : {}) })).entry_id);
      if (copy) await publication.draft.mutate();
      const completion = new Promise<PublishedCopy>((resolve, reject) => { pending.current = { resolve, reject }; });
      setCopy(destination);
      setAttempt(value => value + 1);
      return await completion;
    })().finally(() => { flight.current = null; setBusy(false); });
    flight.current = promise;
    return promise;
  }
  return { publish, prepared: Boolean(copy), busy };
}
