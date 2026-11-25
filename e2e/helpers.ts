import { execFileSync } from "node:child_process";
import { test as base, expect, type Browser, type Page } from "@playwright/test";

/** A client address of its own: each test's main person, and each other person, comes from one. */
export function newAddress(): string {
  const part = () => Math.floor(Math.random() * 250) + 1;
  return `10.${part()}.${part()}.${part()}`;
}

/** Playwright's test, with the test's main browser at its own address. */
export const test = base.extend({
  extraHTTPHeaders: async ({}, use) => use({ "x-forwarded-for": newAddress() }),
});
export { expect };

const MAILPIT = process.env["MAILPIT_URL"] ?? "http://localhost:8026";
export const PASSWORD = "senha-boa-123";

/** An address no earlier run used. */
export function newEmail(name: string): string {
  return `${name}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@exemplo.com`;
}

/** The link in the newest email to an address whose subject contains `subject` (waits for it). */
export async function emailedLink(to: string, subject: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
        const message = messages.find((m) => m.Subject.includes(subject));
        if (!message) return null;
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
          Text: string;
        };
        link = full.Text.match(/http:\/\/localhost:3040\/\S+#t=[\w-]{43}/)?.[0];
        return link ?? null;
      },
      { timeout: 15_000, message: `email "${subject}" to ${to}` },
    )
    .not.toBeNull();
  return link!;
}

/**
 * A visible form field by its label. Next keeps pages navigated away from mounted but hidden (so going
 * back restores them), so the same label can exist twice in the document.
 */
export function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).filter({ visible: true });
}

/** Signs up through the form, which signs in at once; ends on the account page. */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/cadastro");
  await expect(page.getByRole("heading", { name: "Crie sua conta" })).toBeVisible();
  await field(page, "Nome").fill(name);
  await field(page, "E-mail").fill(email);
  await field(page, "Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).filter({ visible: true }).last().click();
  await expect(page.getByRole("heading", { name: `Olá, ${name.split(" ")[0]}!` })).toBeVisible();
  await expect(page).toHaveURL("/conta");
}

/** A second person: a browser context of their own (own cookies), from their own address. */
export async function otherPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: "http://localhost:3040",
    locale: "pt-BR",
    extraHTTPHeaders: { "x-forwarded-for": newAddress() },
  });
  return context.newPage();
}

/** The API through the web app, as the signed-in person in that page. */
export async function call(page: Page, method: "POST" | "PUT", path: string, data: object = {}) {
  const response = await page.request.fetch(`/api${path}`, {
    method,
    data,
    headers: { origin: "http://localhost:3040" },
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  return response.json();
}

const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ?? "postgresql://torra:torra@localhost:5440/torra_e2e";

/**
 * Creates an admin of the store the only way there is (the command line, with database access) and
 * returns the one-time link that sets their password.
 */
export function createAdmin(email: string, name = "Equipe Torra"): string {
  const output = execFileSync("npm", ["run", "admin:create", "-w", "@torra/api", "--", email, name], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WEB_URL: "http://localhost:3040" },
    encoding: "utf8",
  });
  const link = output.match(/http:\/\/localhost:3040\/redefinir-senha#t=[\w-]{43}/)?.[0];
  if (!link) throw new Error(`no link in: ${output}`);
  return link;
}
