import "reflect-metadata"
import { runRetryFailedMediaCommand } from "../runtime/runRetryFailedMediaCommand"

runRetryFailedMediaCommand("audio").catch(error => {
  console.error(error)
  process.exitCode = 1
})
