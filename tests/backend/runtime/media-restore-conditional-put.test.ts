import { Readable } from "node:stream"
import { expect, it, vi } from "vitest"
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { checkConditionalPut } from "../../../bin/check-media-restore-conditional-put.mjs"

it.each(["supported", "ignored", "forbidden", "false-rejection", "occupied"])("checks real rejection semantics for %s", async mode => {
  let stored: string | undefined
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ListObjectsV2Command) return { Contents: mode === "occupied" ? [{ Key: "existing" }] : [] }
    if (command instanceof PutObjectCommand) {
      expect(command.input.IfNoneMatch).toBe("*")
      if (stored && mode !== "ignored") {
        if (mode === "false-rejection") stored = "corrupt"
        throw Object.assign(Error("rejected"), { $metadata: { httpStatusCode: mode === "forbidden" ? 403 : 412 } })
      }
      stored = command.input.Body as string
      return {}
    }
    if (command instanceof GetObjectCommand) return { Body: Readable.from([stored!]) }
    throw Error("Unexpected operation")
  })
  const result = checkConditionalPut({ send } as unknown as Pick<S3Client, "send">, "disposable-probe")
  if (mode === "supported") await expect(result).resolves.toEqual({ conditionalCollisionRejected: true, originalPreserved: true, syntheticProbeRetained: true })
  else await expect(result).rejects.toThrow()
  if (mode === "occupied") { expect(send).toHaveBeenCalledOnce(); expect(stored).toBeUndefined() }
})
