import "reflect-metadata"
import { readFile, writeFile } from "node:fs/promises"
import { PrismaService } from "../../../server/prisma/prisma.service"
import { StorageService } from "../../../server/storage/storage.service"
import { AudioProcessor } from "../../../server/uploads/audio/audio.processor"
import { VideoProcessor } from "../../../server/uploads/video/video.processor"

const [root, kind, id, mode] = process.argv.slice(2)
const prisma = new PrismaService()
const storage = new StorageService()
Object.assign(storage, { localRoot: root, useS3: false })
const gate = async () => {
  if (mode !== "interrupt") return
  process.send?.({ stage: "output-written" })
  await new Promise(() => { setInterval(() => {}, 1000) })
}
const put = storage.put.bind(storage), putFile = storage.putFile.bind(storage)
storage.put = async (...args) => { await put(...args); await gate() }
storage.putFile = async (...args) => { await putFile(...args); await gate() }
const bytes = mode === "interrupt" ? "unfinished output" : "replacement output"
async function run() {
  if (kind === "audio") {
    const processor = new AudioProcessor()
    Object.assign(processor, { prisma, storage })
    processor.transcodeAudioBuffer = async source => {
      if (source.toString() !== "original") throw new Error("Source changed")
      return { buffer: Buffer.from(bytes), durationMs: 200, spectrum: { version: 3 as const, status: "ready" as const, peaks: [0.2], bands: [[1, 0, 0] as [number, number, number]] } }
    }
    await processor.process({ audioAssetId: Number(id) })
  } else {
    const processor = new VideoProcessor()
    Object.assign(processor, { prisma, storage, processVideoFile: async (input: string, output: string) => {
      if ((await readFile(input)).toString() !== "original") throw new Error("Source changed")
      await writeFile(output, bytes)
      return { byteSize: Buffer.byteLength(bytes), posterBuffer: null, durationMs: 200, width: 20, height: 20 }
    } })
    await processor.process({ videoAssetId: Number(id) })
  }
}
run().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exitCode = 1 })
