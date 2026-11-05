import sharp from "sharp"
import { validateImageUpload, IMAGE_UPLOAD_MAX_BYTES } from "@server/uploads/images/image-policy"
import { createImageVariant } from "@server/uploads/images/image-variants"

describe("image upload and transform policy", () => {
  const file = (buffer: Buffer, mimetype = "image/png") => ({ buffer, size: buffer.length, mimetype })

  it("rejects active documents, spoofed images, and oversized files", async () => {
    await expect(validateImageUpload(file(Buffer.from("<html>hello</html>"), "text/html"))).rejects.toThrow(/image/i)
    await expect(validateImageUpload(file(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>"), "image/png"))).rejects.toThrow(/format/i)
    await expect(validateImageUpload({ ...file(Buffer.from("bad")), size: IMAGE_UPLOAD_MAX_BYTES + 1 })).rejects.toThrow(/20 MB/i)
    await expect(validateImageUpload(file(Buffer.from("bad")))).rejects.toThrow(/image/i)
    await expect(createImageVariant(Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1), "w320")).rejects.toThrow(/20 MB/i)
  })

  it("derives MIME type and oriented dimensions from bytes", async () => {
    const buffer = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const result = await validateImageUpload(file(buffer, "image/png"))
    expect(result).toMatchObject({ contentType: "image/jpeg", width: 40, height: 80, frames: 1 })
  })

  it("preserves animation, transparency, and frame timing", async () => {
    const frames = await Promise.all(["red", "blue"].map(background => sharp({ create: { width: 4, height: 4, channels: 4, background } }).png().toBuffer()))
    const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 200], loop: 0 }).toBuffer()
    expect(await validateImageUpload(file(gif, "image/gif"))).toMatchObject({ frames: 2, width: 4, height: 4 })
    const output = await sharp(await createImageVariant(gif, "w600")).metadata()
    expect(output).toMatchObject({ pages: 2, delay: [100, 200], loop: 0 })
    const transparent = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer()
    expect((await sharp(await createImageVariant(transparent, "w600")).metadata()).hasAlpha).toBe(true)
  })

  it("rejects excessive decoded dimensions before transformation", async () => {
    const image = await sharp({ create: { width: 1, height: 9000, channels: 3, background: "red" } }).png().toBuffer()
    await expect(validateImageUpload(file(image))).rejects.toThrow(/dimensions/i)
    await expect(createImageVariant(image, "w600")).rejects.toThrow(/dimensions/i)
  })
})
