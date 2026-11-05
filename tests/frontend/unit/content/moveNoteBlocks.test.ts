import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { getSelectedTopLevelPageBlocks, selectedPageBlocksStillMatch } from "../../../../frontend/src/lib/moveNoteBlocks";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    image: {
      group: "block",
      atom: true,
      attrs: { src: { default: "" } },
      parseDOM: [{ tag: "img" }],
      toDOM: (node) => ["img", node.attrs],
    },
    text: { group: "inline" },
  },
  marks: {},
});

const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const image = (src = "image.png") => schema.nodes.image.create({ src });

function editorWith(selection: TextSelection | NodeSelection) {
  return {
    state: EditorState.create({
      schema,
      doc: selection.$from.doc,
      selection,
    }),
  } as never;
}

function stateWithDoc(nodes: ProseMirrorNode[]) {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, nodes),
  });
}

describe("moveNoteBlocks", () => {
  it("selects the containing block for a cursor", () => {
    const state = stateWithDoc([paragraph("one"), paragraph("two")]);
    const selected = getSelectedTopLevelPageBlocks(editorWith(TextSelection.create(state.doc, 7)));

    expect(selected?.from).toBe(5);
    expect(selected?.to).toBe(10);
    expect(selected?.blocks).toEqual([{ type: "paragraph", content: [{ type: "text", text: "two" }] }]);
  });

  it("expands a partial text selection to its top-level block", () => {
    const state = stateWithDoc([paragraph("one"), paragraph("two")]);
    const selected = getSelectedTopLevelPageBlocks(editorWith(TextSelection.create(state.doc, 2, 4)));

    expect(selected?.from).toBe(0);
    expect(selected?.to).toBe(5);
    expect(selected?.blocks).toEqual([{ type: "paragraph", content: [{ type: "text", text: "one" }] }]);
  });

  it("selects every top-level block intersecting a multi-block selection", () => {
    const state = stateWithDoc([paragraph("one"), paragraph("two"), paragraph("three")]);
    const selected = getSelectedTopLevelPageBlocks(editorWith(TextSelection.create(state.doc, 2, 12)));

    expect(selected?.from).toBe(0);
    expect(selected?.to).toBe(17);
    expect(selected?.blocks.map((block) => block.content?.[0]?.text)).toEqual(["one", "two", "three"]);
  });

  it("handles atom block selections", () => {
    const state = stateWithDoc([paragraph("one"), image() as ReturnType<typeof paragraph>, paragraph("two")]);
    const selected = getSelectedTopLevelPageBlocks(editorWith(NodeSelection.create(state.doc, 5)));

    expect(selected?.from).toBe(5);
    expect(selected?.blocks).toEqual([{ type: "image", attrs: { src: "image.png" } }]);
  });

  it("returns null for an empty document", () => {
    const selected = getSelectedTopLevelPageBlocks({
      state: {
        doc: { childCount: 0 },
        selection: { from: 0, to: 0 },
      },
    } as never);

    expect(selected).toBeNull();
  });

  it("validates the original selected blocks before deletion", () => {
    const state = stateWithDoc([paragraph("one"), paragraph("two")]);
    const editor = editorWith(TextSelection.create(state.doc, 2, 4));
    const selected = getSelectedTopLevelPageBlocks(editor);
    expect(selected).not.toBeNull();

    expect(selectedPageBlocksStillMatch(editor, selected!)).toBe(true);

    const changedState = stateWithDoc([paragraph("changed"), paragraph("two")]);
    expect(selectedPageBlocksStillMatch(editorWith(TextSelection.create(changedState.doc, 2, 4)), selected!)).toBe(false);
  });
});
