// Lint rules for the API and the shared package. The web app has its own config (Next.js rules).
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/**", "**/node_modules/**", "**/src/generated/**", "apps/web/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // NestJS injects by type: classes imported only for constructor parameters must stay value imports.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
]);
