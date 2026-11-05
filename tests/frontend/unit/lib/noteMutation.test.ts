import { describe, expect, it } from 'vitest';
import { mergeNoteMutation, mergeNoteUpdate } from '../../../../frontend/src/lib/noteSubscription';
import type { Note } from '../../../../frontend/src/lib/api/notes';

const original: Note = { id: 1, title: 'Before', icon: null, version: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] } };
const metadata = { ...original, title: 'Renamed', icon: '🎵', version: 2 };
const body: Note = { ...original, version: 3, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest body' }] }] } };

describe('independent Note mutation responses', () => {
  it.each(['meta-first', 'body-first'])('retains both edits when responses arrive %s', order => {
    const result = order === 'meta-first'
      ? mergeNoteMutation(mergeNoteMutation(original, metadata, 'meta'), body, 'content')
      : mergeNoteMutation(mergeNoteMutation(original, body, 'content'), metadata, 'meta');
    expect(result).toMatchObject({ title: 'Renamed', icon: '🎵', content: body.content, version: 3 });
  });
  it('does not reuse another Note or invent a missing cache entry', () => {
    expect(mergeNoteMutation(undefined, metadata, 'meta')).toBe(metadata);
    expect(mergeNoteMutation({ ...original, id: 2 }, metadata, 'meta')).toBe(metadata);
  });
});

it('keeps content and its revision together across stale responses and metadata writes', () => {
  expect(mergeNoteMutation(original, metadata, 'meta').version).toBe(1);
  expect(mergeNoteMutation(body, original, 'content')).toBe(body);
  expect(mergeNoteUpdate(body, { type: 'content', page_id: 1, content: original.content, version: 1 })).toBe(body);
  expect(mergeNoteUpdate(body, { type: 'content', page_id: 1, content: original.content })).toBe(body);
  expect(mergeNoteUpdate(original, { type: 'content', page_id: 1, content: body.content, version: 3 })).toMatchObject({ content: body.content, version: 3 });
});
