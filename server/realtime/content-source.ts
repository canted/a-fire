import { Node, mergeAttributes } from "@tiptap/core"

export const ContentSourceNode = Node.create({
  name: "contentSource",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      sourceType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-type"),
        renderHTML: (attributes) => {
          if (!attributes.sourceType) return {}
          return { "data-source-type": String(attributes.sourceType) }
        },
      },
      sourceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-id"),
        renderHTML: (attributes) => {
          if (!attributes.sourceId) return {}
          return { "data-source-id": String(attributes.sourceId) }
        },
      },
      sourcePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-path"),
        renderHTML: (attributes) => {
          if (!attributes.sourcePath) return {}
          return { "data-source-path": String(attributes.sourcePath) }
        },
      },
      authorName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-author-name"),
        renderHTML: (attributes) => {
          if (!attributes.authorName) return {}
          return { "data-author-name": String(attributes.authorName) }
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-source-label"),
        renderHTML: (attributes) => {
          if (!attributes.label) return {}
          return { "data-source-label": String(attributes.label) }
        },
      },
      nodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute("id") ?? element.getAttribute("data-node-id"),
        renderHTML: (attributes) => {
          if (!attributes.nodeId) return {}
          return { id: String(attributes.nodeId), "data-node-id": String(attributes.nodeId) }
        },
      },
      audioNodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-audio-node-id"),
        renderHTML: (attributes) => {
          if (!attributes.audioNodeId) return {}
          return { "data-audio-node-id": String(attributes.audioNodeId) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-content-source]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-content-source": "true" })]
  },
})
