/** No authenticated media/network access from the isolated fixture gallery. */
export function useMediaSource(value?: string | null) {
  return {
    data:
      value?.startsWith("data:image/") ||
      ["/wall-study.jpg", "/wall-spunky.jpg", "/wall-cool.jpg"].includes(
        value ?? "",
      )
        ? { uri: value }
        : undefined,
    error: undefined,
    isLoading: false,
    mutate: async () => undefined,
  };
}

export function useMediaAsset() {
  return { data: undefined, error: undefined, isLoading: false };
}
