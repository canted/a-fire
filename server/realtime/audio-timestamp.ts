import { Node, mergeAttributes } from "@tiptap/core"

function normalizeAudioSeconds(value: unknown): number {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next) || next < 0) return 0
  return Number(next.toFixed(1))
}

export const AudioTimestampNode = Node.create({
  name: "audioTimestamp",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

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
      audioNodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-audio-node-id"),
        renderHTML: (attributes) => {
          if (!attributes.audioNodeId) return {}
          return { "data-audio-node-id": String(attributes.audioNodeId) }
        },
      },
      sourcePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-href") ?? element.getAttribute("href"),
        renderHTML: (attributes) => {
          if (!attributes.sourcePath) return {}
          return { "data-href": String(attributes.sourcePath) }
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
      seconds: {
        default: 0,
        parseHTML: (element) => normalizeAudioSeconds(element.getAttribute("data-audio-seconds")),
        renderHTML: (attributes) => ({ "data-audio-seconds": String(normalizeAudioSeconds(attributes.seconds)) }),
      },
      nodeId: {
        default: null,
        parseHTML: (element) => element.getAttribute("id") ?? element.getAttribute("data-node-id"),
        renderHTML: (attributes) => {
          if (!attributes.nodeId) return {}
          return { id: String(attributes.nodeId), "data-node-id": String(attributes.nodeId) }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-audio-timestamp]" }, { tag: "a[data-audio-timestamp]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-audio-timestamp": "true" })]
  },
})
