import { withTestDependencies } from "@tests/backend/helpers/service";
import { NotFoundException } from "@nestjs/common"
import { ImageVariantProcessor } from "@server/uploads/images/image-variant.processor"

describe("ImageVariantProcessor", () => {
  function setup() {
    const ensure = vi.fn()
    const document = { findFirst: vi.fn(), update: vi.fn() }
    const processor = withTestDependencies(new ImageVariantProcessor(), { images: { ensure }, prisma: { document } })
    return { processor, ensure, document }
  }
  it("delegates new and already-queued legacy jobs without rewriting a document", async () => {
    const { processor, ensure, document } = setup()
    await processor.process({ blobId: 1, variationDigests: ["w320", "w600"] })
    await processor.process({ blobId: 1, variationDigest: "w1200", entryId: 4, originalUrl: "original", variantUrl: "variant" })
    expect(ensure.mock.calls).toEqual([[1, ["w320", "w600"]], [1, ["w1200"]]])
    expect(document.findFirst).not.toHaveBeenCalled()
    expect(document.update).not.toHaveBeenCalled()
  })
  it("ignores deleted uploads but lets transient failures retry", async () => {
    const { processor, ensure } = setup()
    ensure.mockRejectedValueOnce(new NotFoundException()).mockRejectedValueOnce(new Error("storage down"))
    await expect(processor.process({ blobId: 1, variationDigest: "w600" })).resolves.toBeUndefined()
    await expect(processor.process({ blobId: 1, variationDigest: "w600" })).rejects.toThrow("storage down")
  })
})
