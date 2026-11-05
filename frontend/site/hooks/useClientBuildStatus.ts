import { useEffect, useMemo } from "react";
import { useQuery } from "../lib/swrQuery";
import { useApiClient } from "./useApiClient";

const CLIENT_BUILD_POLL_INTERVAL_MS = 30 * 1000;

type ClientBuildResponse = {
  buildId: string | null;
};

export function useClientBuildStatus({ enabled = true }: { enabled?: boolean } = {}) {
  const apiClient = useApiClient();
  const currentBuildId = useMemo(() => readCurrentBuildId(), []);

  const query = useQuery<ClientBuildResponse>({
    queryKey: ["client-build"],
    queryFn: () => apiClient.get<ClientBuildResponse>("/client-build", { cache: "no-store" }),
    enabled,
    refetchInterval: CLIENT_BUILD_POLL_INTERVAL_MS,
    refetchOnMount: "always",
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    revalidateIfStale: true,
  });

  const latestBuildId = query.data?.buildId ?? null;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!enabled) return;
      if (document.visibilityState === "visible") void query.refetch();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled, query.refetch]);

  return {
    currentBuildId,
    latestBuildId,
    isChecking: query.isFetching,
    updateAvailable: Boolean(currentBuildId && latestBuildId && currentBuildId !== latestBuildId),
  };
}

export function readCurrentBuildId(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.querySelector<HTMLMetaElement>('meta[name="afire-build-id"]')?.content.trim();
  return value || null;
}
