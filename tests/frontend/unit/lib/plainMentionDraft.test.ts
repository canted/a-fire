import { describe, expect, it } from 'vitest';
import { editMentionDraft, insertMention, mentionDocument, mentionQuery, submitsPlainComposer } from '../../../../frontend/src/lib/plainMentionDraft';
import type { MentionTarget } from '../../../../frontend/src/lib/api/mentions';

const target: MentionTarget = { id: 'user:7', targetType: 'user', targetId: '7', label: 'A & B', subtitle: null, avatarUrl: null, icon: null, href: '/app/users/7' };
describe('plain input mention document adapter', () => {
  it('preserves selected identity and line breaks without interpreting markup', () => {
    const draft = insertMention({ text: 'Hi @a\n<script>', mentions: [] }, { start: 3, end: 5 }, target);
    expect(mentionDocument(draft).content?.[0].content).toEqual([
      { type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { id: target.id, targetType: 'user', targetId: '7', label: 'A & B', avatarUrl: null, icon: null, href: target.href } },
      { type: 'text', text: ' ' }, { type: 'hardBreak' }, { type: 'text', text: '<script>' },
    ]);
  });
  it('moves untouched identities and drops identity when its label is edited', () => {
    const original = insertMention({ text: '@a', mentions: [] }, { start: 0, end: 2 }, target);
    const moved = editMentionDraft(original, 'Hello ' + original.text);
    expect(moved.mentions[0].start).toBe(6);
    expect(editMentionDraft(moved, moved.text.replace('A & B', 'A & C')).mentions).toEqual([]);
    expect(editMentionDraft(moved, moved.text + 'after').mentions).toEqual(moved.mentions);
  });
  it('does not suggest inside email addresses, selections or existing identities', () => {
    expect(mentionQuery({ text: 'a@b', mentions: [] }, { start: 3, end: 3 })).toBeNull();
    expect(mentionQuery({ text: 'Hi @pe', mentions: [] }, { start: 6, end: 6 })).toEqual({ start: 3, end: 6, query: 'pe' });
    expect(mentionQuery({ text: '@pe', mentions: [] }, { start: 1, end: 3 })).toBeNull();
    const selected = insertMention({ text: '@a', mentions: [] }, { start: 0, end: 2 }, target);
    expect(mentionQuery(selected, { start: 2, end: 2 })).toBeNull();
  });
  it('only submits a plain Enter, never an IME confirmation or shifted Enter', () => {
    expect(submitsPlainComposer({ key: 'Enter' })).toBe(true);
    for (const extra of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) expect(submitsPlainComposer({ key: 'Enter', ...extra })).toBe(false);
  });
});
