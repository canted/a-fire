import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { TiptapNode } from "./tiptap";

export type SelectedPageBlocks = {
  from: number;
  to: number;
  blocks: TiptapNode[];
  signature: string;
};

type EditorLike = Pick<Editor, "state">;

export function getSelectedTopLevelPageBlocks(editor: EditorLike): SelectedPageBlocks | null {
  const { doc, selection } = editor.state;
  if (doc.childCount === 0) return null;

  const range =
    selection.from === selection.to
      ? collectCursorBlock(doc, selection.from)
      : collectIntersectingBlocks(doc, selection.from, selection.to);

  if (!range) return null;
  return {
    ...range,
    signature: blocksSignature(range.blocks),
  };
}

export function selectedPageBlocksStillMatch(editor: EditorLike, selected: SelectedPageBlocks): boolean {
  const current = collectBlocksInExactRange(editor.state.doc, selected.from, selected.to);
  if (!current) return false;
  return blocksSignature(current.blocks) === selected.signature;
}

function collectCursorBlock(doc: ProseMirrorNode, cursorPos: number): Omit<SelectedPageBlocks, "signature"> | null {
  const $from = doc.resolve(Math.max(0, Math.min(cursorPos, doc.content.size)));
  const index = Math.min($from.index(0), doc.childCount - 1);
  if (index < 0) return null;
  return collectBlockRangeByIndex(doc, index, index);
}

function collectIntersectingBlocks(
  doc: ProseMirrorNode,
  selectionFrom: number,
  selectionTo: number,
): Omit<SelectedPageBlocks, "signature"> | null {
  let firstIndex: number | null = null;
  let lastIndex: number | null = null;
  let position = 0;

  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    const from = position;
    const to = position + node.nodeSize;
    if (from < selectionTo && to > selectionFrom) {
      firstIndex ??= index;
      lastIndex = index;
    }
    position = to;
  }

  if (firstIndex === null || lastIndex === null) {
    return collectCursorBlock(doc, selectionFrom);
  }

  return collectBlockRangeByIndex(doc, firstIndex, lastIndex);
}

function collectBlocksInExactRange(
  doc: ProseMirrorNode,
  rangeFrom: number,
  rangeTo: number,
): Omit<SelectedPageBlocks, "signature"> | null {
  let firstIndex: number | null = null;
  let lastIndex: number | null = null;
  let position = 0;

  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    const from = position;
    const to = position + node.nodeSize;
    if (from >= rangeFrom && to <= rangeTo) {
      firstIndex ??= index;
      lastIndex = index;
    }
    position = to;
  }

  if (firstIndex === null || lastIndex === null) return null;
  const range = collectBlockRangeByIndex(doc, firstIndex, lastIndex);
  if (!range || range.from !== rangeFrom || range.to !== rangeTo) return null;
  return range;
}

function collectBlockRangeByIndex(
  doc: ProseMirrorNode,
  firstIndex: number,
  lastIndex: number,
): Omit<SelectedPageBlocks, "signature"> | null {
  if (firstIndex < 0 || lastIndex < firstIndex || lastIndex >= doc.childCount) return null;

  let position = 0;
  const blocks: TiptapNode[] = [];
  let from = 0;
  let to = 0;

  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    const nodeFrom = position;
    const nodeTo = position + node.nodeSize;
    if (index === firstIndex) from = nodeFrom;
    if (index >= firstIndex && index <= lastIndex) {
      blocks.push(node.toJSON() as TiptapNode);
      to = nodeTo;
    }
    position = nodeTo;
  }

  return blocks.length ? { from, to, blocks } : null;
}

function blocksSignature(blocks: TiptapNode[]): string {
  return JSON.stringify(blocks);
}
