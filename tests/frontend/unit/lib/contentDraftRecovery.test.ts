import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentDraft } from '../../../../frontend/src/lib/contentDraft';
import type { TiptapDoc } from '../../../../frontend/src/lib/tiptap';
const document = (text: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

afterEach(() => vi.useRealTimers());

describe('content draft connection recovery', () => {
  it('retains failed edits through a stale refresh and retries the latest content', async () => {
    const original = document('Original');
    const edited = document('Edited offline');
    const save = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined);
    const draft = createContentDraft({ initialContent: original, onSave: save, autosave: false });
    draft.change(edited);
    await expect(draft.saveNow()).rejects.toThrow('Connection lost');
    draft.seed(original);
    expect(draft.snapshot()).toMatchObject({ content: edited, dirty: true, status: 'Connection lost' });
    await draft.saveNow();
    expect(save).toHaveBeenLastCalledWith(edited);
    expect(draft.snapshot()).toMatchObject({ content: edited, dirty: false, status: null });
    draft.dispose();
  });

  it('does not mark newer edits saved when an older in-flight save completes', async () => {
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const draft = createContentDraft({ initialContent: document('Original'), autosave: false,
      onSave: () => new Promise<void>(resolve => { finish = resolve; started(); }) });
    draft.change(document('First edit'));
    const saving = draft.saveNow();
    await writing;
    const latest = document('Newer edit');
    draft.change(latest);
    finish();
    await saving;
    draft.seed(document('First edit'));
    expect(draft.snapshot()).toMatchObject({ content: latest, dirty: true, status: 'dirty' });
    draft.dispose();
  });
});


it('does not autosave or mark a saved document dirty when preview flushes equivalent JSON', async () => {
  vi.useFakeTimers();
  const original = document('Saved body');
  const save = vi.fn();
  const draft = createContentDraft({ initialContent: original, onSave: save });
  // Database JSON key order differs from the editor's serialization order.
  draft.change({ content: [{ content: [{ text: 'Saved body', type: 'text' }], type: 'paragraph' }], type: 'doc' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(draft.snapshot()).toMatchObject({ content: original, dirty: false, status: null });
  expect(save).not.toHaveBeenCalled();
  draft.dispose();
});

it('keeps a failed-save status when preview flushes the same unsaved document', async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockRejectedValue(new Error('Offline'));
  const draft = createContentDraft({ initialContent: document('Original'), onSave: save });
  const edited = document('Unsaved');
  await expect(draft.saveNow(edited)).rejects.toThrow('Offline');
  draft.change(document('Unsaved'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(save).toHaveBeenCalledOnce();
  expect(draft.snapshot()).toMatchObject({ content: edited, dirty: true, status: 'Offline' });
  draft.dispose();
});

it('autosaves framing changes even when the document JSON is unchanged', async () => {
  vi.useFakeTimers();
  const content = document('Existing body');
  const save = vi.fn().mockResolvedValue(undefined);
  const draft = createContentDraft({ initialContent: content, onSave: save, autosaveDelayMs: 100 });
  draft.markDirty();
  expect(draft.snapshot().dirty).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(save).toHaveBeenCalledWith(content);
  expect(draft.snapshot().dirty).toBe(false);
  draft.dispose();
});

it('keeps newer framing changes dirty when an older save completes', async () => {
  let finish!: () => void;
  const draft = createContentDraft({ initialContent: document('Same body'), autosave: false, onSave: () => new Promise<void>(resolve => { finish = resolve; }) });
  draft.markDirty();
  const pending = draft.saveNow();
  await Promise.resolve(); await Promise.resolve();
  draft.markDirty();
  finish(); await pending;
  expect(draft.snapshot().dirty).toBe(true);
  draft.dispose();
});

 it('retains the draft base revision through refresh and repeated conflicts', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Note changed elsewhere'));
  const draft = createContentDraft({ initialContent: document('Original'), initialVersion: 3, onSave: save, autosave: false });
  const edited = document('Local edit');
  draft.change(edited);
  draft.configure({ initialContent: document('Remote edit'), initialVersion: 4, onSave: save, autosave: false });
  draft.seed(document('Remote edit'), 4);
  await expect(draft.saveNow()).rejects.toThrow('Note changed elsewhere');
  await expect(draft.saveNow()).rejects.toThrow('Note changed elsewhere');
  expect(save.mock.calls.map(call => call[1])).toEqual([3, 3]);
  expect(draft.snapshot()).toMatchObject({ content: edited, dirty: true });
  draft.dispose();
});

it('uses its own committed revision for queued saves while ignoring incoming revisions', async () => {
  let finish!: (version: number) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; })).mockResolvedValueOnce(5);
  const draft = createContentDraft({ initialContent: document('Original'), initialVersion: 3, onSave: save, autosave: false });
  const first = draft.saveNow(document('First'));
  await Promise.resolve(); await Promise.resolve();
  const second = draft.saveNow(document('Second'));
  draft.seed(document('Remote'), 99);
  finish(4);
  await Promise.all([first, second]);
  expect(save.mock.calls.map(call => call[1])).toEqual([3, 4]);
  expect(draft.snapshot()).toMatchObject({ content: document('Second'), dirty: false });
  draft.dispose();
});

it('cancels queued autosave on suspension and saves retained edits once when resumed', async () => {
  vi.useFakeTimers();
  const initialContent = document('Original');
  const onSave = vi.fn().mockResolvedValue(undefined);
  const options = { initialContent, onSave, autosaveDelayMs: 100 };
  const draft = createContentDraft(options);
  draft.change(document('First edit'));
  await vi.advanceTimersByTimeAsync(50);
  draft.configure({ ...options, autosave: false });
  await vi.advanceTimersByTimeAsync(500);
  draft.change(document('Edited while suspended'));
  await vi.advanceTimersByTimeAsync(500);
  expect(onSave).not.toHaveBeenCalled();
  expect(draft.snapshot()).toMatchObject({ content: document('Edited while suspended'), dirty: true });
  draft.configure(options);
  await vi.advanceTimersByTimeAsync(50);
  // A normal render must not postpone the already scheduled save.
  draft.configure(options);
  await vi.advanceTimersByTimeAsync(50);
  expect(onSave).toHaveBeenCalledExactlyOnceWith(document('Edited while suspended'));
  expect(draft.snapshot().dirty).toBe(false);
  draft.dispose();
});

it('lets an in-flight save settle while preserving newer edits during autosave suspension', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const options = { initialContent: document('Original'), autosaveDelayMs: 100,
    onSave: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
  const draft = createContentDraft(options);
  draft.change(document('In flight'));
  await vi.advanceTimersByTimeAsync(100);
  draft.configure({ ...options, autosave: false });
  draft.change(document('Newer retained edit'));
  finish();
  await vi.advanceTimersByTimeAsync(500);
  expect(options.onSave).toHaveBeenCalledTimes(1);
  expect(draft.snapshot()).toMatchObject({ content: document('Newer retained edit'), dirty: true, status: 'dirty' });
  draft.dispose();
});

it('waits for the current revision before publication without saving newer content', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const options = { initialContent: document('Original'), autosaveDelayMs: 100,
    onSave: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
  const draft = createContentDraft(options);
  draft.change(document('Saving'));
  await vi.advanceTimersByTimeAsync(100);
  draft.change(document('Publication payload'));
  draft.configure({ ...options, autosave: false });
  let settled = false;
  const pending = draft.waitForPendingSave().then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await pending;
  await vi.advanceTimersByTimeAsync(500);
  expect(options.onSave).toHaveBeenCalledExactlyOnceWith(document('Saving'));
  expect(draft.snapshot()).toMatchObject({ content: document('Publication payload'), dirty: true });
  draft.dispose();
});

it('propagates an in-flight save failure to a waiting publication', async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const draft = createContentDraft({ initialContent: document('Original'), autosaveDelayMs: 100,
    onSave: () => new Promise<void>((_resolve, reject) => { fail = reject; }) });
  draft.change(document('Unsaved'));
  await vi.advanceTimersByTimeAsync(100);
  const waiting = expect(draft.waitForPendingSave()).rejects.toThrow('Revision conflict');
  fail(new Error('Revision conflict'));
  await waiting;
  expect(draft.snapshot()).toMatchObject({ content: document('Unsaved'), dirty: true, status: 'Revision conflict' });
  draft.dispose();
});
