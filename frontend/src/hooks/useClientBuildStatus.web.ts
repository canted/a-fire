import { useMemo } from "react";
import useSWR from "swr";
import { client } from "../lib/api";
import { getMetaContent } from "../lib/browserMeta";
export function useClientBuildStatus() {
  const current = useMemo(() => getMetaContent("afire-build-id") ?? null, []);
  const query = useSWR(
    current ? ["client-build"] : null,
    () =>
      client.get<{ buildId: string | null }>("/client-build", {
        cache: "no-store",
      }),
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );
  const latest = query.data?.buildId;
  return {
    current,
    latest,
    available: Boolean(current && latest && current !== latest),
  };
}
