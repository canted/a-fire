import { withImageMaterialization, withImageProcessing } from "@server/uploads/images/image-processing"

it("queues cold image work before reading buffers and recovers after a failed operation", async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started: number[] = []
  const work = Array.from({ length: 12 }, (_, id) => withImageMaterialization(async () => {
    started.push(id)
    if (id === 0) await gate
    return id
  }))
  await Promise.resolve()
  expect(started).toEqual([0])
  release()
  expect(await Promise.all(work)).toEqual(Array.from({ length: 12 }, (_, id) => id))
  await expect(withImageMaterialization(async () => { throw new Error("S3 unavailable") })).rejects.toThrow("S3 unavailable")
  expect(await withImageMaterialization(async () => "recovered")).toBe("recovered")
})

it("bounds the queue of buffers awaiting decoding", async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const active = withImageProcessing(() => gate)
  const waiting = withImageProcessing(async () => "second")
  await expect(withImageProcessing(async () => "overflow")).rejects.toThrow("busy")
  release()
  await Promise.all([active, waiting])
  expect(await withImageProcessing(async () => "next")).toBe("next")
})
