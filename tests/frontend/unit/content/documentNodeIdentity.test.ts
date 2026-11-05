import { expect, it } from 'vitest';
import { matchingDocumentNode } from '../../../../frontend/src/lib/documentNodeIdentity';
import type { TiptapNode } from '../../../../frontend/src/lib/tiptap';
it('accepts schema-normalized media requests but returns the original authorized attrs', () => {
  const audio: TiptapNode = { type: 'audio', attrs: { audioAssetId: 7, title: 'Original' } };
  expect(matchingDocumentNode([audio], { type: 'audio', attrs: { audioAssetId: 7, title: 'Changed', nodeId: null, status: 'processing' } })).toBe(audio);
  expect(matchingDocumentNode([audio], { type: 'audio', attrs: { audioAssetId: 8 } })).toBeUndefined();
});
it('rejects changed sources, removed nodes and other occurrences of the same asset', () => {
  const image: TiptapNode = { type: 'image', attrs: { src: '/api/v1/uploads/7', nodeId: 'one' } };
  expect(matchingDocumentNode([image], { ...image, attrs: { ...image.attrs, src: 'https://other.test/image' } })).toBeUndefined();
  expect(matchingDocumentNode([image], { ...image, attrs: { ...image.attrs, nodeId: 'two' } })).toBeUndefined();
  expect(matchingDocumentNode([], image)).toBeUndefined();
});
