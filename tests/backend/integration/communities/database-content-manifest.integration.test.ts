import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

const execute = promisify(execFile)
it("fingerprints retained values and duplicate rows without exposing or changing their contents", async () => {
  const prisma = new PrismaClient()
  const schema = `manifest_${crypto.randomUUID().replaceAll("-", "")}`
  const table = `"${schema}".records`
  const manifest = async () => {
    const { stdout } = await execute(process.execPath, ["bin/database-content-manifest.mjs"], {
      env: { ...process.env, MANIFEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL },
      maxBuffer: 4 * 1024 * 1024,
    })
    expect(stdout).not.toContain("private-manifest-body")
    return JSON.parse(stdout) as { read_only: boolean; tables: Array<{ schema: string; rows: string; digest: string }>; sequences: Array<{ schema: string; last_value: string; is_called: boolean }> }
  }
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    await prisma.$executeRawUnsafe(`CREATE TABLE ${table} (body text, payload bytea, occurred_at timestamptz, metadata jsonb)`)
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE "${schema}".counter START 17`)
    await prisma.$executeRawUnsafe(`INSERT INTO ${table} VALUES ('private-manifest-body', decode('00ff','hex'), '2026-10-30T01:02:03.123456Z', '{"nested":null}'), (NULL,NULL,NULL,NULL), (NULL,NULL,NULL,NULL)`)
    const retained = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY 1`)
    const first = await manifest()
    const record = (value: typeof first) => value.tables.find(row => row.schema === schema)!
    expect(first.read_only).toBe(true)
    expect(record(first).rows).toBe("3")
    expect(first.sequences.find(row => row.schema === schema)).toMatchObject({ last_value: "17", is_called: false })
    expect(record(await manifest())).toEqual(record(first))
    expect(await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY 1`)).toEqual(retained)
    await prisma.$executeRawUnsafe(`UPDATE ${table} SET payload=decode('00fe','hex') WHERE body IS NOT NULL`)
    const edited = await manifest()
    expect(record(edited).rows).toBe("3")
    expect(record(edited).digest).not.toBe(record(first).digest)
    await prisma.$executeRawUnsafe(`INSERT INTO ${table} VALUES (NULL,NULL,NULL,NULL)`)
    const duplicate = await manifest()
    expect(record(duplicate).rows).toBe("4")
    expect(record(duplicate).digest).not.toBe(record(edited).digest)
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await prisma.$disconnect()
  }
}, 30_000)
