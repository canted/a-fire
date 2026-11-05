import type { EntryDraftResponse } from "../contracts/entryDraft";

type Context = { draftQueryKey: Array<string | number | undefined> };
type Cache = {
  removeQueries: (filter: { queryKey: unknown[] }) => unknown;
  invalidateQueries: (filter: { queryKey: unknown[] }) => unknown;
};

/** Publication changes the Room copy and its current-member projection. */
export function entryPublicationCache({ draftQueryKey }: Context, { removeQueries, invalidateQueries }: Cache) {
  return async (published: EntryDraftResponse) => {
    await removeQueries({ queryKey: draftQueryKey });
    await removeQueries({ queryKey: ["post"] });
    await Promise.allSettled([
      invalidateQueries({ queryKey: ["room-home"] }),
      invalidateQueries({ queryKey: ["room-member-posts"] }),
      ...(published.round_id ? [
        invalidateQueries({ queryKey: ["room-rounds"] }),
        invalidateQueries({ queryKey: ["activity", String(published.round_id)] }),
      ] : []),
    ]);
  };
}
