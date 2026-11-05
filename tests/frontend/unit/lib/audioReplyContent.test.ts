import { describe, expect, it } from 'vitest';
import { buildAudioTimestampDoc, hasAudioReplyContent } from '../../../../frontend/src/lib/audioTimestamp';
const source = buildAudioTimestampDoc({ href: '/app/note/1?audio=2', audioAssetId: 2, seconds: 3 });
describe('audio reply content', () => {
  it('requires more than the source timestamp or empty structural nodes', () => {
    expect(hasAudioReplyContent(source)).toBe(false);
    expect(hasAudioReplyContent({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] })).toBe(false);
  });
  it('accepts text and uploaded media without dropping the source marker', () => {
    expect(hasAudioReplyContent({ ...source, content: [...source.content!, { type: 'paragraph', content: [{ type: 'text', text: 'Listen here' }] }] })).toBe(true);
    expect(hasAudioReplyContent({ ...source, content: [...source.content!, { type: 'audio', attrs: { audioAssetId: 3 } }] })).toBe(true);
  });
});
