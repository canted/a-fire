import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import storybook from "eslint-plugin-storybook"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "frontend/.expo/**",
      "frontend/ios/**",
      "frontend/android/**",
      "frontend/expo-env.d.ts",
      // Byte-for-byte generated copy; bin/expo-assets.mjs --check verifies it.
      "frontend/public/service-worker.js",
      "public/assets/**",
      "public/frontend/assets/**",
      "public/site/**",
      "storage/**",
      "tmp/**",
      "log/**",
      "vendor/**",
      "tests/e2e/reports/**",
    ],
  },
  {
    files: [
      "**/*.{js,mjs,cjs,jsx}",
      "bin/dev",
      "bin/test",
      "bin/rename-site-html",
      "bin/server-smoke",
      "bin/notification-smoke",
      "bin/stage",
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        ignoreRestSiblings: true,
      }],
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "JSXOpeningElement[name.name='img']", message: "Use AppImage for image sources, responsive sizing, loading, and failure states. See server/uploads/images/README.md." },
        { selector: "CallExpression[callee.property.name='createElement'][arguments.0.value='img']", message: "Use AppImage instead of creating image elements directly." },
      ],
    },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    ignores: ["frontend/src/lib/contentImageSchema.ts", "frontend/src/features/content/RichDocumentEditor.tsx"],
    rules: { "no-restricted-imports": ["error", { paths: [{ name: "@tiptap/extension-image", message: "Use createImageNode from the canonical content ImageNode." }] }] },
  },
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    ignores: ["frontend/src/**/*.web.{ts,tsx}", "frontend/src/features/content/RichDocumentEditor.tsx", "frontend/src/features/rounds/RoundDateFields.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["react-dom", "react-router-dom"],
        patterns: [{
          group: ["@/*", "@mui/*", "@emotion/*", "@radix-ui/*", "*.css"],
          message: "Universal Expo modules must not import the legacy web UI or its React 18 dependency graph. Use a platform adapter.",
        }, { group: ["@tiptap/*"], allowTypeImports: true, message: "Schema factories may describe the supplied editor runtime, but only DOM adapters may import Tiptap runtime values." }],
      }],
    },
  },
  {
    // Explicit Expo DOM adapter: the shared schema factory still owns image semantics.
    files: ["frontend/src/features/content/RichDocumentEditor.tsx", "frontend/src/features/rounds/RoundDateFields.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/*", "@mui/*", "@emotion/*", "@radix-ui/*", "react-router-dom", "**/hooks/*", "**/lib/api", "**/lib/sessionStorage"], allowTypeImports: true, message: "The DOM editor receives document data and callbacks; native SWR adapters own authentication and transfers." }] }],
      "no-restricted-syntax": ["error",
        { selector: "Program:not(:has(ExpressionStatement[directive='use dom']))", message: "This adapter must retain Expo's use dom boundary." },
        { selector: "JSXOpeningElement[name.name='img']", message: "Use the authorized native media preview; do not fetch images inside the DOM editor." },
        { selector: "CallExpression[callee.object.name='Image'][callee.property.name='extend']", message: "Reuse createContentImageSchema; do not define a second image schema." },
      ],
    },
  },
  {
    files: ["server/api/**/*.controller.ts"],
    ignores: ["server/api/v1/uploads/uploads.controller.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [{ name: "multer", importNames: ["memoryStorage"], message: "Use IMAGE_MULTIPART_OPTIONS for bounded image uploads." }] }] },
  },
  {
    files: [
      "server/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "bin/dev",
      "bin/test",
      "bin/rename-site-html",
      "bin/server-smoke",
      "bin/notification-smoke",
      "bin/stage",
      "tests/backend/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "vite.config.ts",
      "vitest.config.ts",
      "vitest.setup.ts",
      "playwright.config.ts",
      "tsup.config.ts",
    ],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  ...storybook.configs["flat/recommended"],
)
