export type MediaByteRange = {
  start: number
  end: number
  total: number
}

export type MediaStreamPayload = {
  stream: NodeJS.ReadableStream
  filename: string
  contentType: string
  byteSize: number
  etag?: string
  range?: MediaByteRange | null
}

export function parseMediaRange(rangeHeader: string | null | undefined, totalBytes: number): MediaByteRange | null {
  if (!rangeHeader || !Number.isFinite(totalBytes) || totalBytes <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  let start: number
  let end: number

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(totalBytes - suffixLength, 0)
    end = totalBytes - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : totalBytes - 1
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null
  if (start >= totalBytes) return null

  return {
    start,
    end: Math.min(end, totalBytes - 1),
    total: totalBytes,
  }
}
