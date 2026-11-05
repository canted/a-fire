import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type BlockInfo = {
  parent: ProseMirrorNode;
  index: number;
  node: ProseMirrorNode;
  from: number;
  to: number;
};

export const getBlockInfo = (editor: Editor): BlockInfo | null => {
  const { state } = editor;
  if ("node" in state.selection && (state.selection as { node?: ProseMirrorNode }).node?.isBlock) {
    const { $from, from, to } = state.selection;
    const parent = $from.parent;
    const index = $from.index();
    const node = (state.selection as { node?: ProseMirrorNode }).node;
    if (!node) return null;
    return { parent, index, node, from, to };
  }
  const { $from } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isBlock) {
    depth -= 1;
  }
  if (depth <= 0) return null;
  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const node = $from.node(depth);
  const from = $from.before(depth);
  const to = $from.after(depth);
  return { parent, index, node, from, to };
};

export function moveEditorBlock(editor: Editor, direction: "up" | "down") {
    const blockInfo = getBlockInfo(editor);
    if (!blockInfo) return;
    const { parent, index, node, from, to } = blockInfo;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= parent.childCount) return;
    const targetNode = parent.child(targetIndex);
    if (!targetNode) return;

    const tr = editor.state.tr;
    tr.delete(from, to);
    const insertPos =
      direction === "up" ? tr.mapping.map(from - targetNode.nodeSize) : tr.mapping.map(to + targetNode.nodeSize);
    tr.insert(insertPos, node);
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    if (node.isAtom || node.isLeaf || node.type.name === "image") {
      editor.commands.setNodeSelection(insertPos);
      return;
    }
    const selectionPos = Math.min(insertPos + 1, tr.doc.content.size);
    editor.commands.setTextSelection(selectionPos);
  }
