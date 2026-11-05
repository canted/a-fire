import { describe, expect, it } from 'vitest';
import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { contentTextExtensions } from '../../../../frontend/src/lib/contentTextExtensions';
import { createContentImageSchema } from '../../../../frontend/src/lib/contentImageSchema';
import { createContentMentionRuntime } from '../../../../frontend/src/lib/contentMention';
import { createAudioTimestampSchema } from '../../../../frontend/src/lib/audioTimestampSchema';
import { audioNodeSchema, videoNodeSchema, fileNodeSchema, noteLinkNodeSchema, contentSourceNodeSchema } from '../../../../frontend/src/lib/contentNodeSchemas';
import { moveEditorBlock } from '../../../../frontend/src/lib/editorBlocks';

function editor(content: object) {
  const { createMentionNode } = createContentMentionRuntime({ Mention, PluginKey, mergeAttributes });
  return new Editor({ extensions: [
    ...contentTextExtensions({ StarterKit, TextAlign, TextStyleKit, Highlight, Link }),
    createContentImageSchema({ Image, mergeAttributes }, true),
    createMentionNode({ renderMode: 'editor' }), createAudioTimestampSchema({ Node, mergeAttributes }),
    ...[audioNodeSchema('editor'), videoNodeSchema('editor'), fileNodeSchema('editor'), noteLinkNodeSchema(), contentSourceNodeSchema()].map(config => Node.create(config)),
  ], content });
}
describe('shared legacy and Expo editor schema', () => {
  it('retains inline atoms and media metadata while formatting adjacent prose', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Text' }, { type: 'mention', attrs: { id: 'u1', label: 'Ada', targetId: '1', targetType: 'user', href: '/app' } }, { type: 'audioTimestamp', attrs: { audioAssetId: '9', seconds: 4.2, sourcePath: '/app/note/1?audio=9&t=4.2', nodeId: 'stamp' } }] },
      { type: 'audio', attrs: { audioAssetId: '9', nodeId: 'audio-9', title: 'Recording', status: 'ready' } },
      { type: 'video', attrs: { videoAssetId: '10', title: 'Clip', status: 'ready', width: 640, height: 480, durationMs: 2200 } },
      { type: 'image', attrs: { src: '/api/v1/uploads/1', alt: 'Art', width: 640, height: 480 } },
      { type: 'file', attrs: { src: '/api/v1/uploads/2', filename: 'Score.pdf', size: 55, contentType: 'application/pdf' } },
      { type: 'noteLink', attrs: { noteId: '3' } },
      { type: 'contentSource', attrs: { sourceType: 'Post', sourceId: '4', sourcePath: '/app/entries/4', nodeId: 'source' } },
    ];
    const value = editor({ type: 'doc', content: blocks });
    try {
      value.commands.setTextSelection({ from: 1, to: 5 });
      value.commands.toggleBold();
      expect(value.getJSON().content?.slice(0, blocks.length)).toMatchObject(blocks);
      expect(value.getJSON().content?.at(-1)?.type).toBe("paragraph"); // StarterKit trailing-node editing affordance.
      expect(value.getJSON().content?.[0].content?.[0].marks).toContainEqual({ type: 'bold' });
      value.commands.undo();
      expect(value.getJSON().content?.[0].content?.[0].marks).toBeUndefined();
    } finally { value.destroy(); }
  });
  it('moves a selected block without dropping its rich content', () => {
    const value = editor({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
    ] });
    try {
      value.commands.setTextSelection(1);
      moveEditorBlock(value, 'down');
      expect(value.getJSON().content?.map(node => { const child = node.content?.[0]; return child && 'text' in child ? child.text : undefined; })).toEqual(['Second', 'First']);
      expect(value.getJSON().content?.[1].content?.[0].marks).toContainEqual({ type: 'bold' });
    } finally { value.destroy(); }
  });
});
