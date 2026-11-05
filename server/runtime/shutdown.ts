import type { Server } from "node:http"

export const SHUTDOWN_TIMEOUT_MS = 40_000

/** One bounded shutdown, even when the platform repeats its termination signal. */
export function installShutdownHandlers(
  shutdown: () => Promise<void>,
  options: {
    timeoutMs?: number
    target?: Pick<NodeJS.Process, "on" | "off" | "exit">
    error?: (message: string, error?: unknown) => void
  } = {},
): () => void {
  const target = options.target ?? process
  const report = options.error ?? console.error
  let started = false
  let finished = false
  const handler = () => {
    if (started) return
    started = true
    const timer = setTimeout(() => {
      finished = true
      report("Graceful shutdown deadline exceeded")
      target.exit(1)
    }, options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS)
    void Promise.resolve().then(shutdown).then(() => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      target.exit(0)
    }, error => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      report("Graceful shutdown failed", error)
      target.exit(1)
    })
  }
  target.on("SIGINT", handler)
  target.on("SIGTERM", handler)
  return () => { target.off("SIGINT", handler); target.off("SIGTERM", handler) }
}

/** Stop admission first; active HTTP requests keep their database until they finish. */
export function drainHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error)
      else resolve()
    })
    server.closeIdleConnections()
  })
}
