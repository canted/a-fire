import { useMemo } from "react";
import { ApiClient, apiClient as sharedApiClient } from "../lib/api/client";

/**
 * Returns a memoized API client instance.
 * Allows overriding baseUrl in the future without refactoring call sites.
 */
export function useApiClient(baseUrl?: string): ApiClient {
  return useMemo(() => {
    if (!baseUrl) return sharedApiClient;
    return new ApiClient(baseUrl);
  }, [baseUrl]);
}
