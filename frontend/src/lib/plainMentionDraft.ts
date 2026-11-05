import { plainTextLinkNodes } from "./linkPreviewDetection";
import type { MentionTarget } from './api/mentions';
import type { TiptapDoc, TiptapNode } from './tiptap';

export type MentionSpan = { start: number; end: number; target: MentionTarget };
export type PlainMentionDraft = { text: string; mentions: MentionSpan[] };

/** Native text inputs expose text edits, not document transactions. Keep only
 * untouched mention ranges; editing inside a label deliberately makes it text. */
export function editMentionDraft(draft: PlainMentionDraft, text: string): PlainMentionDraft {
  let start = 0;
  while (start < draft.text.length && start < text.length && draft.text[start] === text[start]) start++;
  let end = draft.text.length;
  let nextEnd = text.length;
  while (end > start && nextEnd > start && draft.text[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  const delta = nextEnd - end;
  return { text, mentions: draft.mentions.flatMap(span => {
    if (span.end <= start) return [span];
    if (span.start >= end) return [{ ...span, start: span.start + delta, end: span.end + delta }];
    return [];
  }) };
}

export function mentionQuery(draft: PlainMentionDraft, selection: { start: number; end: number }) {
  if (selection.start !== selection.end) return null;
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft.text.slice(0, selection.start));
  if (!match) return null;
  const start = selection.start - match[1].length - 1;
  if (draft.mentions.some(span => start >= span.start && start < span.end)) return null;
  return { start, end: selection.start, query: match[1] };
}

export function insertMention(draft: PlainMentionDraft, range: { start: number; end: number }, target: MentionTarget) {
  const label = `@${target.label}`;
  const next = editMentionDraft(draft, draft.text.slice(0, range.start) + label + ' ' + draft.text.slice(range.end));
  next.mentions.push({ start: range.start, end: range.start + label.length, target });
  next.mentions.sort((a, b) => a.start - b.start);
  return { ...next, cursor: range.start + label.length + 1 };
}

export function mentionDocument(draft: PlainMentionDraft): TiptapDoc {
  const content: TiptapNode[] = [];
  let cursor = 0;
  for (const span of draft.mentions) {
    if (span.start < cursor || draft.text.slice(span.start, span.end) !== `@${span.target.label}`) continue;
    if (span.start > cursor) content.push({ type: 'text', text: draft.text.slice(cursor, span.start) });
    const { id, targetType, targetId, label, avatarUrl, icon, href } = span.target;
    content.push({ type: 'mention', attrs: { id, targetType, targetId, label, avatarUrl, icon, href } });
    cursor = span.end;
  }
  if (cursor < draft.text.length) content.push({ type: 'text', text: draft.text.slice(cursor) });
  // Preserve explicit newlines as hard breaks, including empty lines.
  const inline = content.flatMap(node => node.type !== 'text' ? [node] :
    node.text!.split('\n').flatMap((text, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...plainTextLinkNodes(text)]));
  return { type: 'doc', content: [{ type: 'paragraph', content: inline }] };
}

export function submitsPlainComposer(event: { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
