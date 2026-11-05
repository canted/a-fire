const DEFAULT_STARTUP_TIMEOUT_MS = 30_000

type StartupTimeoutOptions = {
  label?: string
  timeoutMs?: number
}

export class StartupTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not complete within ${timeoutMs}ms`)
    this.name = "StartupTimeoutError"
  }
}

export function resolveStartupTimeoutMs(rawValue = process.env.API_STARTUP_TIMEOUT_MS): number {
  const parsed = Number(rawValue)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return DEFAULT_STARTUP_TIMEOUT_MS
}

export async function withStartupTimeout<T>(
  operation: Promise<T>,
  options: StartupTimeoutOptions = {},
): Promise<T> {
  const label = options.label ?? "Startup"
  const timeoutMs = options.timeoutMs ?? resolveStartupTimeoutMs()
  let timeout: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new StartupTimeoutError(label, timeoutMs))
    }, timeoutMs)
    const nodeTimeout = timeout as ReturnType<typeof setTimeout> & { unref?: () => void }
    nodeTimeout.unref?.()
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
