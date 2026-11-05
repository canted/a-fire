import "reflect-metadata"
import { runRetryFailedMediaCommand } from "../runtime/runRetryFailedMediaCommand"

runRetryFailedMediaCommand("video").catch(error => {
  console.error(error)
  process.exitCode = 1
})
