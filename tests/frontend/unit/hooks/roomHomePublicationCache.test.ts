import { expect, it, vi } from 'vitest';
import { entryPublicationCache } from '../../../../frontend/src/lib/entryPublicationCache';

it('removes the published draft and refreshes the Room home and member history', async () => {
  const cache = { removeQueries: vi.fn(), invalidateQueries: vi.fn() };
  await entryPublicationCache({ draftQueryKey: ['draft', 1] }, cache)({ id: 1 } as never);
  expect(cache.removeQueries.mock.calls).toEqual([
    [{ queryKey: ['draft', 1] }], [{ queryKey: ['post'] }],
  ]);
  expect(cache.invalidateQueries.mock.calls).toEqual([
    [{ queryKey: ['room-home'] }], [{ queryKey: ['room-member-posts'] }],
  ]);
});

it('also refreshes the Round after contribution publication', async () => {
  const cache = { removeQueries: vi.fn(), invalidateQueries: vi.fn() };
  await entryPublicationCache({ draftQueryKey: ['draft', 1] }, cache)({ id: 1, round_id: 7 } as never);
  expect(cache.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['activity', '7'] });
  expect(cache.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['room-rounds'] });
});
