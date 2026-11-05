import { useRef } from "react";
import { randomUuid } from "../lib/randomId";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";
import { fetchMemberships } from "../lib/api/profile";
import {
  shareProjectEntry,
  fetchEntryShareManifest,
  fetchPreparedEntryShare,
  type ShareProjectEntryInput,
} from "../lib/api/projectEntries";
import { useRoomRounds } from "./useRounds";
import { client } from "../lib/api";
export function useProjectShare(project: string, entry: number, room: string, selection = false) {
  const memberships = useSWR("memberships", () => fetchMemberships(client));
  const rounds = useRoomRounds(room, Boolean(room));
  const requestKey = useRef<string | undefined>(undefined);
  requestKey.current ??= randomUuid();
  const inFlight = useRef<ReturnType<typeof shareProjectEntry> | null>(null);
  const manifest = useSWR(selection && room ? ["project-share-selection", project, entry, room] : null,
    () => fetchEntryShareManifest(client, project, entry, room),
    { revalidateOnFocus: false });
  const share = useSWRMutation(
    ["project-share", project, entry],
    (_, { arg }: { arg: ShareProjectEntryInput }) => {
      if (inFlight.current) return inFlight.current;
      const request = shareProjectEntry(client, project, entry, {
        ...arg, request_key: arg.request_key ?? requestKey.current,
      }).finally(() => { inFlight.current = null; });
      inFlight.current = request;
      return request;
    },
  );
  return { memberships, ...rounds, manifest, share };
}

export function usePreparedEntryShare(project: string, entry: string, requestKey?: string) {
  return useSWR(requestKey ? ["prepared-entry-share", project, entry, requestKey] : null,
    () => fetchPreparedEntryShare(client, project, entry, requestKey!), { revalidateOnFocus: false });
}
