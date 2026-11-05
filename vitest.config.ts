import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  plugins: [{ name: "public-site-react-runtime", enforce: "pre", resolveId(source, importer) {
    if (!importer?.includes("/frontend/site/") || !/^(?:react(?:-dom)?|swr)(?:\/|$)/.test(source)) return;
    return import.meta.resolve(source).replace("file://", "");
  } }],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "frontend/site"),
      "@server": path.resolve(__dirname, "server"),
      "@tests": path.resolve(__dirname, "tests"),
    },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    globals: true,
    // Preserve the canonical token source for literal-color consumers.
    css: { include: /tokens\.css/ },
    // Shells may export development; database-backed tests must still load .env.test.
    env: { NODE_ENV: "test" },
    setupFiles: ["./vitest.setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.{ts,tsx}"],
          // VM contexts retain per-file isolation while reusing the expensive jsdom worker setup.
          maxWorkers: 4,
          pool: "vmThreads",
          vmMemoryLimit: "512MB",
        },
      },
      {
        extends: true,
        test: {
          name: "backend",
          globalSetup: ["./tests/backend/setup-database.ts"],
          environment: "node",
          include: ["tests/backend/**/*.test.{ts,tsx}"],
          // Database-backed integration tests share one test database.
          maxWorkers: 1,
        },
      },
    ],
    exclude: ["**/node_modules/**", "**/vendor/rails/**", "**/tests/e2e/**"],
  },
})
