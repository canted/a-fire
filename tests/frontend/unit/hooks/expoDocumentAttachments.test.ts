import { afterEach, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
const doubles = vi.hoisted(() => ({ upload: vi.fn(), pick: vi.fn(), release: vi.fn() }));
vi.mock('../../../../frontend/src/hooks/useAttachmentUpload', () => ({ useAttachmentUpload: () => ({ trigger: doubles.upload }) }));
vi.mock('../../../../frontend/src/hooks/useChatRecording', () => ({ useChatRecording: () => ({ recording: false, preparing: false }) }));
vi.mock('../../../../frontend/src/lib/chatFiles', () => ({ pickChatFile: doubles.pick, releaseChatFile: doubles.release }));
const expo = '../../../../frontend';
const { act, createElement } = await import(`${expo}/node_modules/react/index.js`) as typeof import('react');
const { createRoot } = await import(`${expo}/node_modules/react-dom/client.js`) as typeof import('react-dom/client');
const { useDocumentAttachments } = await import(`${expo}/src/hooks/useDocumentAttachments.ts`);
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; vi.clearAllMocks(); });
it('retains a failed file and clears the visible error when retry inserts it', async () => {
  const file = { id: 'file-1', name: 'synthetic.txt', type: 'text/plain', uri: 'file:///synthetic.txt' };
  const node = { type: 'file', attrs: { fileAssetId: 1 } };
  doubles.pick.mockResolvedValue(file);
  doubles.upload.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(node);
  const insert = vi.fn().mockResolvedValue(undefined);
  const error = vi.fn();
  let result: ReturnType<typeof useDocumentAttachments>;
  function Probe() { result = useDocumentAttachments(1, insert, error); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => result.pick('file'));
  expect(result!.attachment).toEqual(file);
  expect(error).toHaveBeenLastCalledWith('Offline');
  expect(insert).not.toHaveBeenCalled();
  await act(async () => result.insert());
  expect(error).toHaveBeenLastCalledWith(undefined);
  expect(insert).toHaveBeenCalledExactlyOnceWith(node);
  expect(result!.attachment).toBeUndefined();
});


it.each(['file', 'photo', 'camera'] as const)('uploads and inserts a chosen %s without confirmation', async (kind) => {
  const file = { id: 'photo-1', name: 'photo.png', type: 'image/png', uri: 'blob:photo' };
  const node = { type: 'image', attrs: { src: '/image/1' } };
  doubles.pick.mockResolvedValue(file);
  doubles.upload.mockResolvedValue(node);
  const insert = vi.fn().mockResolvedValue(undefined);
  let result!: ReturnType<typeof useDocumentAttachments>;
  function Probe() { result = useDocumentAttachments(1, insert, vi.fn()); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => result.pick(kind));
  expect(doubles.upload).toHaveBeenCalledExactlyOnceWith({ attachment: file, draftId: 1, blockId: file.id });
  expect(insert).toHaveBeenCalledExactlyOnceWith(node);
  expect(result.attachment).toBeUndefined();
  expect(result.pending).toBe(false);
  expect(doubles.release).toHaveBeenCalledWith(file);
});

it('does not upload cancelled or disallowed selections', async () => {
  doubles.pick.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 'image', name: 'photo.png', type: 'image/png' });
  const insert = vi.fn();
  const error = vi.fn();
  let result!: ReturnType<typeof useDocumentAttachments>;
  function Probe() { result = useDocumentAttachments(1, insert, error, { media: ['audio'] }); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => result.pick('file'));
  await act(async () => result.pick('file'));
  expect(doubles.upload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(error).toHaveBeenLastCalledWith('Choose audio media for this contribution.');
  expect(result.pending).toBe(false);
});

it('retains the uploaded node for insertion retry without uploading twice', async () => {
  const node = { type: 'file', attrs: { fileAssetId: 1 } };
  doubles.pick.mockResolvedValue({ id: 'file', name: 'file.txt', type: 'text/plain' });
  doubles.upload.mockResolvedValue(node);
  const insert = vi.fn().mockRejectedValueOnce(new Error('Editor unavailable')).mockResolvedValue(undefined);
  let result!: ReturnType<typeof useDocumentAttachments>;
  function Probe() { result = useDocumentAttachments(1, insert, vi.fn()); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => result.pick('file'));
  expect(result.pending).toBe(true);
  await act(async () => result.insert());
  expect(doubles.upload).toHaveBeenCalledTimes(1);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(result.pending).toBe(false);
});
