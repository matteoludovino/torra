// Bundles the API into dist/main.js. Workspace code (@torra/shared, the generated Prisma client) is inlined;
// installed packages stay external and load from node_modules. SWC compiles the TypeScript so the
// decorator metadata NestJS injects by is emitted (esbuild alone doesn't emit it).
// `node build.mjs --watch` rebuilds on change and restarts the API.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { context } from "esbuild";
import swc from "unplugin-swc";

const watch = process.argv.includes("--watch");
const { dependencies } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(dependencies).filter((name) => !name.startsWith("@torra/"));

const ctx = await context({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // Subpath imports too: one copy of each package, from node_modules.
  external: [...external, ...external.map((name) => `${name}/*`)],
  plugins: [swc.esbuild({ tsconfigFile: "tsconfig.json" })],
  // ESM output: give bundled CommonJS helpers a require().
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

if (!watch) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.rebuild();
  await ctx.watch();
  spawn("node", ["--enable-source-maps", "--env-file-if-exists=.env", "--watch-path=dist", "dist/main.js"], {
    stdio: "inherit",
  });
}
