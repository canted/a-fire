import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import { loadTestEnvironment } from "./test-environment.mjs"

export function loadEnv(): void {
  if (process.env.NODE_ENV === "test") {
    loadTestEnvironment()
    return
  }
  const defaultEnvPath = path.resolve(process.cwd(), ".env")
  if (fs.existsSync(defaultEnvPath)) {
    dotenv.config({ path: defaultEnvPath, override: false })
  }
}
