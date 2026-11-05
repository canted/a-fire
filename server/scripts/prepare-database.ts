import { ensureDatabaseUrl } from "../runtime/env"
import { loadEnv } from "../runtime/loadEnv"
import { runPrismaMigrateDeploy } from "../runtime/migrations"

loadEnv()
ensureDatabaseUrl()
await runPrismaMigrateDeploy()
