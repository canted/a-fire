import { promises as fs } from "node:fs"
import path from "node:path"
import { StorageService } from "../../../server/storage/storage.service"

const [, , root, mode] = process.argv
const storage = new StorageService()
Object.assign(storage, { localRoot: root, useS3: false })
fs.rename = async () => {
  process.send?.({ stage: "ready-to-publish" })
  await new Promise<void>(() => { setInterval(() => {}, 1000) })
}
if (mode === "buffer") await storage.put("uploads/object", Buffer.from("replacement"))
else await storage.putFile("uploads/object", path.join(root, "source"))
