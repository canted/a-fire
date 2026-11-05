import { describe, expect, it, vi } from "vitest"
import { AudioSpectrumProcessor } from "@server/uploads/audio/audio-spectrum.processor"

function setup() {
  const asset = { id: 41, blob_id: 9, processing_status: 'ready', blob: { key: 'audio/41', byte_size: 4, metadata: '{"duration_ms":5000}' } }
  const prisma = { audioAsset: { findUnique: vi.fn().mockResolvedValue(asset) }, activeStorageBlob: { updateMany: vi.fn() } }
  const storage = { getBuffer: vi.fn().mockResolvedValue(Buffer.alloc(4)) }
  const processor = new AudioSpectrumProcessor()
  Object.assign(processor, { prisma, storage })
  const analyze = vi.spyOn(processor as any, 'analyzeFile')
  return { processor, prisma, storage, analyze }
}

describe('AudioSpectrumProcessor', () => {
  it('adds display metadata without replacing media and protects concurrent metadata writes', async () => {
    const { processor, prisma, analyze } = setup()
    const spectrum = { version: 3, status: 'ready', peaks: [1], bands: [[1, 0, 0]] }
    analyze.mockResolvedValue(spectrum)
    await processor.process({ audioAssetId: 41 })
    expect(prisma.activeStorageBlob.updateMany).toHaveBeenCalledWith({
      where: { id: 9, key: 'audio/41', byte_size: 4, metadata: '{"duration_ms":5000}' },
      data: { metadata: JSON.stringify({ duration_ms: 5000, spectrum }) },
    })
  })
  it('does not permanently cache a temporary storage failure', async () => {
    const { processor, prisma, storage, analyze } = setup()
    storage.getBuffer.mockRejectedValue(new Error('temporary storage failure'))
    await expect(processor.process({ audioAssetId: 41 })).rejects.toThrow('temporary storage failure')
    expect(analyze).not.toHaveBeenCalled()
    expect(prisma.activeStorageBlob.updateMany).not.toHaveBeenCalled()
  })
  it('keeps playback available when optional analysis cannot decode the media', async () => {
    const { processor, prisma, analyze } = setup()
    analyze.mockRejectedValue(new Error('unsupported decode'))
    await processor.process({ audioAssetId: 41 })
    expect(JSON.parse(prisma.activeStorageBlob.updateMany.mock.calls[0][0].data.metadata)).toEqual({
      duration_ms: 5000, spectrum: { version: 3, status: 'unavailable' },
    })
  })
})
