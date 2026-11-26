import { defineConfig, devices } from "@playwright/test";

// End-to-end runs against the production builds (npm run build first): the bundled API and `next start`,
// on their usual ports, with a database of their own, sending real email to Mailpit (npm run db:up).
const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ?? "postgresql://torra:torra@localhost:5440/torra_e2e";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3040",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      // Playwright starts the servers before any global setup: the database is prepared (migrated, with
      // the seeded marketplace) right before the API starts.
      command: `npm run db:prepare -w @torra/api -- ${E2E_DATABASE_URL} && npm run db:seed -w @torra/api && npm run start -w @torra/api`,
      url: "http://localhost:8050/api/health",
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        WEB_ORIGINS: "http://localhost:3040",
        WEB_URL: "http://localhost:3040",
        SMTP_URL: "smtp://localhost:1026",
        // Behind the web app's rewrite, as in production: client addresses come from X-Forwarded-For,
        // and each person in the tests has their own (see e2e/helpers.ts), so per-address limits apply
        // as they would to real people.
        TRUST_PROXY: "true",
        LOG_LEVEL: "warn",
        // No outside services in end-to-end runs: the CEP directory "doesn't answer", and the checkout's
        // fallback (picking the state) is what gets exercised.
        VIACEP_URL: "http://127.0.0.1:9/ws",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run start -w @torra/web",
      url: "http://localhost:3040",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
