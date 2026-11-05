import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const smoke = await import(pathToFileURL(path.resolve("bin/notification-smoke")).href)

describe("notification-smoke", () => {
  const originalEnv = {
    FLY_APP_NAME: process.env.FLY_APP_NAME,
    FLY_CONFIG: process.env.FLY_CONFIG,
    SMOKE_BASE_URL: process.env.SMOKE_BASE_URL,
    SMOKE_CIRCLE_ID: process.env.SMOKE_CIRCLE_ID,
    SMOKE_DEPLOY_COMMIT_LIMIT: process.env.SMOKE_DEPLOY_COMMIT_LIMIT,
    SMOKE_DEPLOY_MARKER_PATH: process.env.SMOKE_DEPLOY_MARKER_PATH,
    SMOKE_DEPLOY_PREVIOUS_SHA: process.env.SMOKE_DEPLOY_PREVIOUS_SHA,
    SMOKE_NOTIFICATION_FORCE: process.env.SMOKE_NOTIFICATION_FORCE,
    SMOKE_NOTIFICATION_TEXT: process.env.SMOKE_NOTIFICATION_TEXT,
    SMOKE_REQUIRE_NOTIFICATION: process.env.SMOKE_REQUIRE_NOTIFICATION,
    SMOKE_SESSION_PATH: process.env.SMOKE_SESSION_PATH,
  }

  beforeEach(() => {
    for (const key of Object.keys(originalEnv)) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      restoreEnv(key, value)
    }
  })

  it("parses deploy arguments and smoke-specific environment", () => {
    process.env.SMOKE_BASE_URL = "https://env.example.test"
    process.env.SMOKE_SESSION_PATH = "tmp/session.json"
    process.env.SMOKE_CIRCLE_ID = "44"

    expect(smoke.parseNotificationSmokeArgs(["--app", "stage-app", "--config=fly.stage.toml"])).toEqual(
      expect.objectContaining({
        app: "stage-app",
        baseUrl: "https://env.example.test",
        configPath: "fly.stage.toml",
        sessionPath: "tmp/session.json",
        roomId: 44,
      }),
    )
  })

  it("uses the shared agent session by default", () => {
    expect(smoke.parseNotificationSmokeArgs([])).toEqual(
      expect.objectContaining({
        sessionPath: "tmp/agent-session.json",
        timeoutMs: 120_000,
      }),
    )
  })

  it("runs only for production unless forced", () => {
    expect(smoke.shouldRunNotificationSmoke({ app: "afire", configPath: "fly.toml" })).toBe(true)
    expect(smoke.shouldRunNotificationSmoke({ app: "afire-staging", configPath: "fly.toml" })).toBe(false)

    process.env.SMOKE_NOTIFICATION_FORCE = "1"
    expect(smoke.shouldRunNotificationSmoke({ app: "afire-staging", configPath: "fly.toml" })).toBe(true)

    process.env.SMOKE_REQUIRE_NOTIFICATION = "0"
    expect(smoke.shouldRunNotificationSmoke({ app: "afire", configPath: "fly.toml" })).toBe(false)
  })

  it("builds smoke chat-message content from the configured text", () => {
    process.env.SMOKE_NOTIFICATION_TEXT = "Deploy smoke"

    expect(smoke.smokeMessageContent(new Date("2026-06-28T20:00:00.000Z"))).toEqual({
      body: "Deploy smoke",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Deploy smoke" }] }],
      },
    })
  })

  it("builds smoke chat-message content from deploy context", () => {
    expect(
      smoke.smokeMessageContent(new Date("2026-06-28T20:00:00.000Z"), {
        appName: "afire",
        roomId: 4,
        deploySummary: {
          heading: "Recent commits (last 5; no previous deploy marker)",
          commits: [{ sha: "abc1234", subject: "Add deploy summary" }],
        },
      }),
    ).toEqual({
      body: [
        "Recent commits (last 5; no previous deploy marker)",
        "- abc1234 Add deploy summary",
      ].join("\n"),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Recent commits (last 5; no previous deploy marker)" }] },
          { type: "paragraph", content: [{ type: "text", text: "- abc1234 Add deploy summary" }] },
        ],
      },
    })
  })

  it("uses the deployed commit as the chat idempotency key", () => {
    expect(smoke.smokeMessageClientNonce("abcdef123456")).toBe("deploy-smoke-abcdef123456")
    expect(smoke.smokeMessageClientNonce(null, new Date("2026-06-28T20:00:00.000Z"))).toBe("deploy-smoke-1782676800000")
  })

  it("creates a regular chat message without pinning it", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ id: 42 })
    const session = { accessToken: "access", refreshToken: "refresh" }

    await expect(smoke.createSmokeMessage({
      baseUrl: "https://example.test",
      roomId: 4,
      messageContent: { body: "Deploy smoke", content: { type: "doc", content: [] } },
      clientNonce: "deploy-smoke-abcdef123456",
      session,
      sessionPath: "tmp/session.json",
      request,
    })).resolves.toEqual({ id: 42 })

    expect(request).toHaveBeenNthCalledWith(1,
      "https://example.test",
      "/api/v2/rooms/4/chat/messages",
      { method: "POST", body: { body: "Deploy smoke", content: { type: "doc", content: [] }, client_nonce: "deploy-smoke-abcdef123456" } },
      session,
      "tmp/session.json",
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("summarizes commits since the last successful deploy marker", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "notification-smoke-"))
    git(repo, "init")
    git(repo, "config", "user.email", "smoke@example.test")
    git(repo, "config", "user.name", "Smoke Test")

    commitFile(repo, "one.txt", "one", "First deploy")
    const firstSha = git(repo, "rev-parse", "HEAD")
    commitFile(repo, "two.txt", "two", "Second deploy")
    commitFile(repo, "three.txt", "three", "Third deploy")

    const markerPath = path.join(repo, ".git", "notification-smoke-last-deploy-sha")
    fs.writeFileSync(markerPath, `${firstSha}\n`)

    const summary = await smoke.deployCommitSummary({ cwd: repo, markerPath, limit: 5 })

    expect(summary).toEqual(
      expect.objectContaining({
        mode: "since-last-deploy",
        previousSha: firstSha,
        heading: expect.stringContaining(`(${firstSha.slice(0, 8)}..`),
      }),
    )
    expect(summary.commits).toEqual([
      expect.objectContaining({ subject: "Third deploy" }),
      expect.objectContaining({ subject: "Second deploy" }),
    ])
  })

  it("extracts the final JSON payload from Fly command output", () => {
    expect(smoke.extractJsonFromOutput("Connecting...\n{\"event_id\":408,\"sent_count\":3}\n")).toEqual({
      event_id: 408,
      sent_count: 3,
    })
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function commitFile(repo: string, name: string, content: string, message: string) {
  fs.writeFileSync(path.join(repo, name), content)
  git(repo, "add", name)
  git(repo, "commit", "-m", message)
}

function git(repo: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
}
