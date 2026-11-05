import useSWR from "swr";
import { fetchMentionTargets } from "../lib/api/mentions";
import { client } from "../lib/api";

export function useMentionTargets(room?: string | number, enabled = true) {
  return useSWR(
    enabled && room ? ["mention-targets", String(room)] : null,
    () => fetchMentionTargets(client, room!),
    { dedupingInterval: 15_000 },
  );
}
