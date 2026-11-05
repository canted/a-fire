import { Node, mergeAttributes } from "@tiptap/core"

export const AudioNode = Node.create({
  name: "audio",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      audioAssetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-audio-asset-id"),
        renderHTML: (attributes) => {
          if (!attributes.audioAssetId) return {}
          return { "data-audio-asset-id": String(attributes.audioAssetId) }
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-audio-title"),
        renderHTML: (attributes) => {
          if (!attributes.title) return {}
          return { "data-audio-title": String(attributes.title) }
        },
      },
      status: {
        default: "processing",
        parseHTML: (element) => element.getAttribute("data-audio-status"),
        renderHTML: (attributes) => {
          if (!attributes.status) return {}
          return { "data-audio-status": String(attributes.status) }
        },
      },
      nodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute("id") ?? element.getAttribute("data-audio-node-id"),
        renderHTML: (attributes) => {
          if (!attributes.nodeId) return {}
          return { id: String(attributes.nodeId), "data-audio-node-id": String(attributes.nodeId) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-audio-node]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-audio-node": "true" })]
  },
})
