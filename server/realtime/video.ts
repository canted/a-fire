import { Node, mergeAttributes } from "@tiptap/core"

export const VideoNode = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      videoAssetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-video-asset-id"),
        renderHTML: (attributes) => {
          if (!attributes.videoAssetId) return {}
          return { "data-video-asset-id": String(attributes.videoAssetId) }
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-video-title"),
        renderHTML: (attributes) => {
          if (!attributes.title) return {}
          return { "data-video-title": String(attributes.title) }
        },
      },
      status: {
        default: "processing",
        parseHTML: (element) => element.getAttribute("data-video-status"),
        renderHTML: (attributes) => {
          if (!attributes.status) return {}
          return { "data-video-status": String(attributes.status) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-video-node]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-video-node": "true" })]
  },
})
