/** Preview documents have no external navigation; presentation buttons open local detail. */
export function useContentLink() {
  return { error: undefined, open: async () => undefined };
}
