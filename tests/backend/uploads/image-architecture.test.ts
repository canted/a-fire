// @vitest-environment node
import { ESLint } from "eslint"
import fs from "node:fs"

it("CI lint prevents bypassing the canonical image renderer, Tiptap node, and multipart limits", async () => {
  const eslint = new ESLint()
  const examples = [
    ["frontend/src/features/entries/Regression.web.tsx", 'const Image = () => <img src="/image.png" alt="" />'],
    ["frontend/src/features/entries/Regression.web.tsx", 'import Image from "@tiptap/extension-image"'],
    ["server/api/v1/profile/regression.controller.ts", 'import { memoryStorage } from "multer"'],
  ]
  for (const [filePath, code] of examples) {
    const [result] = await eslint.lintText(code, { filePath })
    expect(result.errorCount, filePath).toBeGreaterThan(0)
  }
  expect(fs.readFileSync("server/uploads/images/image-variant.processor.ts", "utf8")).not.toMatch(/\.document\.(?:update|upsert|delete|create)/)
})
