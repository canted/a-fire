import {
  resolveStartupTimeoutMs,
  withStartupTimeout,
} from "@server/runtime/startupTimeout"

describe("startup timeout", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves when startup finishes before the timeout", async () => {
    await expect(withStartupTimeout(Promise.resolve("ok"), { timeoutMs: 100 })).resolves.toBe("ok")
  })

  it("rejects when startup does not finish before the timeout", async () => {
    vi.useFakeTimers()

    const startup = withStartupTimeout(new Promise(() => {}), { label: "API startup", timeoutMs: 100 })
    const assertion = expect(startup).rejects.toMatchObject({
      name: "StartupTimeoutError",
      message: "API startup did not complete within 100ms",
    })

    await vi.advanceTimersByTimeAsync(100)

    await assertion
  })

  it("falls back to the default timeout for invalid values", () => {
    expect(resolveStartupTimeoutMs("not-a-number")).toBe(30_000)
    expect(resolveStartupTimeoutMs("-1")).toBe(30_000)
  })
})
