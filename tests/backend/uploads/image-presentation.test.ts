import { imageDimensionsFromMetadata, presentImageDocuments } from "@server/api/v1/uploads/image-presentation"

describe("decoded image metadata dimensions", () => {
  it("preserves validated portrait orientation", () => {
    expect(imageDimensionsFromMetadata(JSON.stringify({ contentType: "image/jpeg", width: 600, height: 900 }))).toEqual({ width: 600, height: 900 })
  })
  it.each([
    null, undefined, "broken", "null", JSON.stringify({ width: 900, height: 600 }),
    JSON.stringify({ contentType: "image/jpeg", width: "900", height: 600 }),
    JSON.stringify({ contentType: "image/jpeg", width: 900, height: 0 }),
    JSON.stringify({ contentType: "image/jpeg", width: 900, height: 9000 }),
  ])("does not reserve a layout from malformed or legacy metadata: %s", metadata => {
    expect(imageDimensionsFromMetadata(metadata)).toBeNull()
  })
})

describe("document image presentation", () => {
  it("hydrates replies/pages/posts in one metadata query, handles nested images, and leaves stored content untouched", async () => {
    const docs = [1, 2, 1].map(id => ({ type: "doc", content: [{ type: "blockquote", content: [{ type: "image", attrs: { src: `/api/v1/uploads/${id}` } }] }] }))
    const before = JSON.stringify(docs)
    const findMany = vi.fn().mockResolvedValue([
      { id: 1, metadata: JSON.stringify({ contentType: "image/jpeg", width: 40, height: 80 }) },
      { id: 2, metadata: "broken" },
    ])
    const shown: any = await presentImageDocuments({ activeStorageBlob: { findMany } } as any, docs)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [1, 2] } } }))
    expect(shown[0].content[0].content[0].attrs).toEqual({ src: "/api/v1/uploads/1/variants/w1200", width: 40, height: 80 })
    expect(shown[1].content[0].content[0].attrs.src).toContain("/variants/w1200")
    expect(JSON.stringify(docs)).toBe(before)
  })
  it("avoids extra queries when dimensions already exist or images are external", async () => {
    const findMany = vi.fn()
    await presentImageDocuments({ activeStorageBlob: { findMany } } as any, [{ type: "doc", content: [
      { type: "image", attrs: { src: "/api/v1/uploads/1", width: 800, height: 600 } },
      { type: "image", attrs: { src: "https://example.com/image.png" } },
    ] }])
    expect(findMany).not.toHaveBeenCalled()
  })
})
