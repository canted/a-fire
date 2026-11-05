import { describe, expect, it, vi } from 'vitest';
import { replyHrefForTrack, type AudioTrack } from '../../../../frontend/src/lib/audioPlayback';
import { audioAssetRecord } from '../../../../frontend/src/lib/api/audioAsset';
import { loadAudioMediaBlob } from '../../../../frontend/src/lib/audioMediaTransfer';
import { sessionReturnPath, safeRoomReturn } from '../../../../frontend/src/lib/roomLinks';
import { seedAudioReply, entryReplyDocument } from '../../../../frontend/src/lib/entryReplyDraft';
import { acknowledgeChatSend, emptyRoomDraft } from '../../../../frontend/src/lib/chatComposition';
const track: AudioTrack = { id: '9', title: 'Test audio', playbackUrl: '/audio', downloadUrl: '/audio' };
describe('shared audio navigation and reply context', () => {
  it('resolves post, reply and Note sources without inventing a Chat reply destination', () => {
    expect(replyHrefForTrack({ ...track, sourceType: 'Post', sourceId: '12' }, 14.37)).toBe('/app/entries/12/new-reply?audio=9&t=14.4');
    expect(replyHrefForTrack({ ...track, sourceType: 'Reply', parentPostId: '12' }, 14)).toBe('/app/entries/12/new-reply?audio=9&t=14');
    expect(replyHrefForTrack({ ...track, sourceType: 'Note', sourceId: '3', audioNodeId: 'node' }, 2)).toBe('/app/note/3/audio-reply?audio=9&audioNode=node&t=2');
    expect(replyHrefForTrack({ ...track, sourceType: 'ChatMessage', sourceId: '1' }, 2)).toBeNull();
  });
  it('withholds reply navigation when the authorized source has no feedback destination', () => {
    const asset = audioAssetRecord({ id: 9, source_type: 'Post', source_id: 12, reply_available: false });
    expect(replyHrefForTrack(asset, 2)).toBeNull();
  });
  it('retains authorized source metadata and rejects unknown source types', () => {
    expect(audioAssetRecord({ id: 9, source_type: 'Reply', parent_entry_id: 12, source_id: 3 })).toMatchObject({ id: '9', sourceType: 'Reply', parentPostId: '12', sourceId: '3' });
    expect(audioAssetRecord({ id: 9, source_type: 'unknown' }).sourceType).toBeNull();
  });
  it('preserves valid cold-start intent through authentication, rejecting external and malformed targets', () => {
    expect(sessionReturnPath('/app/entries/12/new-reply', { audio: '9', t: '14.4' })).toBe('/app/entries/12/new-reply?audio=9&t=14.4');
    expect(sessionReturnPath('/app/entries/12/new-reply', { audio: '9', t: 'Infinity' })).toBe('/app');
    expect(sessionReturnPath('//evil.invalid/app/entries/12/new-reply', { audio: '9' })).toBe('/app');
    expect(sessionReturnPath('/app/rooms/2/chat', { wall: '3' })).toBe('/app/rooms/2/chat?wall=3');
  });
  it('seeds only an empty reply and retains context in the published snapshot', () => {
    const empty = emptyRoomDraft();
    const seed = seedAudioReply(empty, '12', '9', 14.4);
    const draft = { ...empty, ...seed, text: 'My reply' };
    expect(entryReplyDocument(draft).content?.[0]?.content?.[0]).toMatchObject({ type: 'audioTimestamp', attrs: { audioAssetId: '9', seconds: 14.4 } });
    expect(seedAudioReply(draft, '12', '10', 3)).toEqual({});
    expect(seedAudioReply({ ...empty, text: 'Already typed' }, '12', '9', 3)).toEqual({});
    const pending = { body: draft.text, content: entryReplyDocument(draft), nonce: 'request', revision: draft.revision };
    expect(acknowledgeChatSend({ ...draft, pending }, pending)).toMatchObject({ prefix: undefined, text: '', pending: null });
    expect(acknowledgeChatSend({ ...draft, pending, revision: draft.revision + 1 }, pending)).not.toHaveProperty('prefix');
  });
});
describe('private audio transfer lifetime', () => {
  it('shares only concurrent transfers in the same session and revalidates later attempts', async () => {
    let finish!: (value: Blob) => void;
    const getBlob = vi.fn(() => new Promise<Blob>(resolve => { finish = resolve; }));
    const client = { getBlob };
    const first = loadAudioMediaBlob(client, 'session-a', '/audio');
    expect(loadAudioMediaBlob(client, 'session-a', '/audio')).toBe(first);
    finish(new Blob(['test'])); await first;
    const next = loadAudioMediaBlob(client, 'session-a', '/audio');
    expect(next).not.toBe(first); expect(getBlob).toHaveBeenCalledTimes(2);
    finish(new Blob()); await next;
    const same = loadAudioMediaBlob(client, 'session-a', '/audio');
    const other = loadAudioMediaBlob(client, 'session-b', '/audio');
    expect(same).not.toBe(other); expect(getBlob).toHaveBeenCalledTimes(4);
  });
  it('does not retain failures', async () => {
    const client = { getBlob: vi.fn().mockRejectedValue(new Error('denied')) };
    await expect(loadAudioMediaBlob(client, 'session', '/audio')).rejects.toThrow('denied');
    await expect(loadAudioMediaBlob(client, 'session', '/audio')).rejects.toThrow('denied');
    expect(client.getBlob).toHaveBeenCalledTimes(2);
  });
});

it('preserves every canonical guided feedback intent through sign-in', () => {
  for (const type of ['impression', 'question', 'idea']) expect(safeRoomReturn(`/app/entries/12/new-reply?feedback_type=${type}`)).toBe(`/app/entries/12/new-reply?feedback_type=${type}`);
  expect(safeRoomReturn('/app/entries/12/new-reply?feedback_type=appreciation')).toBe('/app');
});

it('preserves supported source timestamp URLs through authentication', async () => {
  const { safeRoomReturn } = await import('../../../../frontend/src/lib/roomLinks');
  expect(safeRoomReturn('/app/entries/10?audio=11&t=2.6&audioNode=phrase-2')).toBe('/app/entries/10?audio=11&t=2.6&audioNode=phrase-2');
  expect(safeRoomReturn('/app/rooms/3/chat?audio=11&t=2.6#chat-4')).toBe('/app/rooms/3/chat?audio=11&t=2.6#chat-4');
  expect(safeRoomReturn('/app/entries/10?audio=11&audio=12')).toBe('/app');
  expect(safeRoomReturn('/app/entries/10?audio=11&next=https://external.test')).toBe('/app');
});
