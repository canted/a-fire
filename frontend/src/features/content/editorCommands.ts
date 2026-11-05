export const editorTools = [
  ["bold", "Bold"],
  ["italic", "Italic"],
  ["underline", "Underline"],
  ["strike", "Strike"],
  ["highlight", "Highlight"],
  ["code", "Inline code"],
  ["heading1", "Heading 1"],
  ["heading2", "Heading 2"],
  ["heading3", "Heading 3"],
  ["paragraph", "Paragraph"],
  ["bulletList", "Bulleted list"],
  ["orderedList", "Numbered list"],
  ["blockquote", "Quote"],
  ["codeBlock", "Code block"],
  ["divider", "Divider"],
  ["left", "Align left"],
  ["center", "Align center"],
  ["right", "Align right"],
  ["clearMarks", "Clear formatting"],
  ["moveUp", "Move up"],
  ["moveDown", "Move down"],
  ["undo", "Undo"],
  ["redo", "Redo"],
] as const;
export type EditorCommand = {
  id: number;
  name:
    | (typeof editorTools)[number][0]
    | "link"
    | "unlink"
    | "mention"
    | "removeBlocks";
  value?: string;
};

export const editorToolIcons = {
  bold: "textB",
  italic: "textItalic",
  underline: "textUnderline",
  strike: "textStrikethrough",
  highlight: "highlighter",
  code: "code",
  heading1: "textHOne",
  heading2: "textHTwo",
  heading3: "textHThree",
  paragraph: "textT",
  bulletList: "listBullets",
  orderedList: "listNumbers",
  codeBlock: "codeBlock",
  divider: "minus",
  left: "textAlignLeft",
  center: "textAlignCenter",
  right: "textAlignRight",
  clearMarks: "textTSlash",
  moveUp: "arrowLineUp",
  moveDown: "arrowLineDown",
} as const;
