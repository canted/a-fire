import { Node, mergeAttributes } from "@tiptap/core"

export const NoteLinkNode = Node.create({
  name: "noteLink",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note-id") ?? element.getAttribute("data-page-id"),
        renderHTML: (attributes) => {
          if (!attributes.noteId) return {}
          return { "data-note-id": String(attributes.noteId) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-note-link]" }, { tag: "div[data-page-link]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-link": "true" })]
  },
})

export const PageLinkNode = NoteLinkNode
