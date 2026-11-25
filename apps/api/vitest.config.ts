import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgresql://torra:torra@localhost:5440/torra_test";

export default defineConfig({
  // NestJS needs decorator metadata, which Vite's esbuild transform doesn't emit: compile with SWC.
  plugins: [swc.vite({ tsconfigFile: "tsconfig.json" })],
  test: {
    globalSetup: ["test/global-setup.ts"],
    // One database shared by every test file: files run one at a time.
    fileParallelism: false,
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
