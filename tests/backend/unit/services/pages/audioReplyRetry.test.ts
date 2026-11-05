import { describe, expect, it } from 'vitest';
import { insertBlocksAfterAudioNode, type TiptapNode } from '../../../../../server/api/v1/pages/page-content-blocks';
const audio: TiptapNode = { type: 'audio', attrs: { audioAssetId: 1 } };
const reply = (id: string): TiptapNode[] => [{ type: 'paragraph', content: [{ type: 'audioTimestamp', attrs: { audioAssetId: 1, nodeId: id } }, { type: 'text', text: 'Feedback' }] }];
describe('timestamped Note reply retries', () => {
  it('does not append an acknowledged reply again after a lost response', () => {
    const first = insertBlocksAfterAudioNode([audio], reply('audio-reply-unique'), { audioAssetId: 1 });
    const retry = insertBlocksAfterAudioNode(first.nodes, reply('audio-reply-unique'), { audioAssetId: 1 });
    expect(retry.inserted).toBe(true);
    expect(retry.nodes).toBe(first.nodes);
    expect(retry.nodes).toHaveLength(2);
  });
  it('allows another reply to the same audio and still rejects an absent target', () => {
    const first = insertBlocksAfterAudioNode([audio], reply('audio-reply-one'), { audioAssetId: 1 });
    expect(insertBlocksAfterAudioNode(first.nodes, reply('audio-reply-two'), { audioAssetId: 1 }).nodes).toHaveLength(3);
    expect(insertBlocksAfterAudioNode([], reply('audio-reply-one'), { audioAssetId: 1 }).inserted).toBe(false);
  });
});
