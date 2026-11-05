import { isImageVariationDigest } from "../uploads/images/image-variants"

export function parseRepairImageVariantArgs(args: string[]) {
  let blobId: number | undefined, execute = false
  const digests: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--execute") { execute = true; continue }
    const value = args[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    if (arg === "--blob-id" && /^\d+$/.test(value)) blobId = Number(value)
    else if (arg === "--digest" && isImageVariationDigest(value)) digests.push(value)
    else throw new Error(`Unsupported option or value for ${arg}`)
  }
  if (!blobId || !Number.isSafeInteger(blobId) || blobId > 2147483647) throw new Error("--blob-id requires a positive database ID")
  if (!digests.length) throw new Error("Specify at least one supported --digest")
  return { blobId, digests: [...new Set(digests)].sort(), execute }
}

export function parseImageVariantInventoryArgs(args: string[]) {
  let afterId = 0, limit = 25
  const digests: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index], value = args[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    if (arg === "--after-id" && /^\d+$/.test(value)) afterId = Number(value)
    else if (arg === "--limit" && /^\d+$/.test(value)) limit = Number(value)
    else if (arg === "--digest" && isImageVariationDigest(value)) digests.push(value)
    else throw new Error(`Unsupported option or value for ${arg}`)
  }
  if (!Number.isSafeInteger(afterId) || afterId < 0 || afterId > 2147483647 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid inventory cursor or limit")
  if (!digests.length) throw new Error("Specify at least one supported --digest")
  return { afterId, limit, digests: [...new Set(digests)].sort() }
}
