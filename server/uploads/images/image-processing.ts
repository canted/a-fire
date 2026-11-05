import { ServiceUnavailableException } from "@nestjs/common"

function serialQueue(maxPending: number) {
  let pending = 0
  let tail: Promise<unknown> = Promise.resolve()
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (pending >= maxPending) throw new ServiceUnavailableException("Image processing is busy. Please try again shortly.")
    pending += 1
    const work = tail.then(operation)
    tail = work.catch(() => undefined)
    try { return await work } finally { pending -= 1 }
  }
}

// Encoded buffers can already exist when upload validation enters this queue.
export const withImageProcessing = serialQueue(2)
// Waiting materializations retain only IDs. Acquire the DB lock and fetch source bytes
// once admitted, so a cold image grid does not buffer dozens of full originals.
export const withImageMaterialization = serialQueue(64)
