import { vi } from "vitest";

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn() },
  existsSync: vi.fn(),
}));

vi.mock("dotenv", () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));
vi.mock("@server/runtime/test-environment.mjs", () => ({ loadTestEnvironment: vi.fn() }));

import fs from "node:fs";
import dotenv from "dotenv";
import { loadEnv } from "@server/runtime/loadEnv";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";

describe("runtime/loadEnv", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("selects the test env in Vitest without a caller overriding NODE_ENV", () => {
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    loadEnv();

    expect(loadTestEnvironment).toHaveBeenCalled();
    expect(dotenv.config).not.toHaveBeenCalled();
  });

  it("loads default env when present", () => {
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => path.endsWith(".env"));
    process.env.NODE_ENV = "development";

    loadEnv();

    expect(dotenv.config).toHaveBeenCalledWith(expect.objectContaining({ override: false }));
  });

  it("delegates test environment loading to the shared isolation guard", () => {
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => path.endsWith(".env.test"));
    process.env.NODE_ENV = "test";

    loadEnv();

    expect(loadTestEnvironment).toHaveBeenCalled();
    expect(dotenv.config).not.toHaveBeenCalled();
  });

  it("does nothing when no env files", () => {
    process.env.NODE_ENV = "development";
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    loadEnv();
    expect(dotenv.config).not.toHaveBeenCalled();
  });
});
