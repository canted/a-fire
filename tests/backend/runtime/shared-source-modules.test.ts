import "reflect-metadata"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { NestFactory } from "@nestjs/core"
import { expect, it } from "vitest"
import { UnseenModule } from "@server/api/v1/unseen/unseen.module"
import { UnseenContentService } from "@server/api/v1/unseen/unseen-content.service"

it("loads Expo-owned portable modules through the API development ESM runtime", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { assertRoomEntrySource } from './server/api/v1/entries/room-entry-policy';
    if (typeof assertRoomEntrySource !== 'function') throw new Error('Missing Room Entry policy');
    console.log('loaded');
  `], { env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.server.json" }, timeout: 10000 })
  expect(stdout.trim()).toBe("loaded")
})

it("resolves the unseen notification serializer and its current Room-access dependency", async () => {
  const app = await NestFactory.createApplicationContext(UnseenModule, { logger: false, abortOnError: false })
  try { expect(app.get(UnseenContentService)).toBeInstanceOf(UnseenContentService) }
  finally { await app.close() }
}, 15000)
