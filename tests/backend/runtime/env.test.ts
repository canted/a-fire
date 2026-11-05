import { ensureDatabaseUrl } from "@server/runtime/env";

describe("runtime/env", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = original;
  });

  it("throws when missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => ensureDatabaseUrl()).toThrow("DATABASE_URL is required");
  });

  it("passes when set", () => {
    process.env.DATABASE_URL = "postgres://example";
    expect(() => ensureDatabaseUrl()).not.toThrow();
  });
});
