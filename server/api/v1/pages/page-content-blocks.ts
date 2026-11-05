import { audioReplyMarker, findDocumentNode } from "../../../../frontend/src/lib/documentNodeIdentity"

export type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

export type TiptapDoc = {
  type: "doc"
  content?: TiptapNode[]
}

export type AudioInsertionTarget = {
  audioAssetId: number
  audioNodeId?: string | null
}

export function insertBlocksAfterAudioNode(
  nodes: TiptapNode[],
  blocks: TiptapNode[],
  target: AudioInsertionTarget,
): { nodes: TiptapNode[]; inserted: boolean } {
  // Timestamped replies carry a stable operation identity. Both the live Yjs
  // transaction and stored-document fallback use this check after authorization.
  const replyId = audioReplyMarker(blocks)
  if (replyId && findDocumentNode(nodes, replyId)) return { nodes, inserted: true }
  const nextNodes: TiptapNode[] = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (isTargetAudioNode(node, target)) {
      nextNodes.push(node, ...blocks, ...nodes.slice(index + 1))
      return { nodes: nextNodes, inserted: true }
    }

    if (node.content?.length) {
      const nested = insertBlocksAfterAudioNode(node.content, blocks, target)
      if (nested.inserted) {
        nextNodes.push({ ...node, content: nested.nodes }, ...nodes.slice(index + 1))
        return { nodes: nextNodes, inserted: true }
      }
    }

    nextNodes.push(node)
  }

  return { nodes: nextNodes, inserted: false }
}

export function isTargetAudioNode(node: TiptapNode, target: AudioInsertionTarget) {
  if (node.type !== "audio") return false

  const nodeId = node.attrs?.nodeId
  if (target.audioNodeId && typeof nodeId === "string" && nodeId === target.audioNodeId) return true

  const audioAssetId = node.attrs?.audioAssetId
  return audioAssetId !== null && audioAssetId !== undefined && String(audioAssetId) === String(target.audioAssetId)
}
