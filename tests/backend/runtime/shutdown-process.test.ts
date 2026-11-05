import { spawn } from "node:child_process"
import { build } from "esbuild"
import { expect, it, vi } from "vitest"

it.each(["SIGTERM", "SIGINT"] as const)("awaits cleanup under real %s signals", async signal => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { installShutdownHandlers } from './server/runtime/shutdown';
    const keepAlive = setInterval(() => {}, 1000);
    installShutdownHandlers(async () => {
      console.log('draining');
      await new Promise(resolve => process.stdin.once('data', resolve));
      clearInterval(keepAlive);
      console.log('cleanup-complete');
    });
    console.log('ready');
  ` }, bundle: true, write: false, platform: "node", format: "esm" })
  const child = spawn(process.execPath, ["--input-type=module", "-e", bundle.outputFiles[0].text], { stdio: ["pipe", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", chunk => { output += String(chunk) })
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
  try {
    await vi.waitFor(() => expect(output).toContain("ready"))
    child.kill(signal)
    await vi.waitFor(() => expect(output).toContain("draining"))
    expect(child.exitCode).toBeNull()
    child.kill(signal === "SIGTERM" ? "SIGINT" : "SIGTERM")
    child.stdin.write("finish\n")
    expect(await exited).toEqual({ code: 0, signal: null })
    expect(output.split("draining")).toHaveLength(2)
    expect(output).toContain("cleanup-complete")
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await exited
  }
})
