import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, it } from "vitest"

it.each(["", "private-sentinel-not-url", "https://private-user:private-password@127.0.0.1/private-db", "postgresql://private-user:private-password@127.0.0.1:1/private-db"])("fails without exposing target details (%#)", async target => {
  const error = await promisify(execFile)(process.execPath, ["bin/room-structure-inventory.mjs"], {
    env: { ...process.env, INVENTORY_DATABASE_URL: target }, timeout: 15000,
  }).catch(error => error)
  expect(error.code).toBe(1)
  expect(error.stdout).toBe("")
  expect(error.stderr).toContain("No complete inventory established")
  expect(error.stderr).not.toContain("private-")
  expect(error.stderr).not.toContain("Error:")
})
