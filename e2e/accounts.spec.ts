import { PASSWORD, emailedLink, field, newEmail, otherPerson, signUp, expect, test } from "./helpers";

test("sign up (signed in at once), confirm the address later by email, rename", async ({ page }) => {
  const email = newEmail("carla");
  await signUp(page, "Carla Dias", email);
  await expect(page.getByText(`Confirme seu e-mail (${email})`)).toBeVisible();

  // The confirmation link, opened later: the token was in the fragment and leaves the address bar.
  await page.goto(await emailedLink(email, "Confirme seu e-mail"));
  await expect(page).toHaveURL("/conta");
  expect(page.url()).not.toContain("#t=");
  await expect(page.getByText(`Confirme seu e-mail (${email})`)).toBeHidden();

  await field(page, "Nome").fill("Carla Dias Souza");
  await page.getByRole("button", { name: "Salvar nome" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nome salvo." })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Conta" }).getByRole("link", { name: "Carla Dias Souza" }),
  ).toBeVisible();

  // The same address can't be signed up twice; the form says so.
  const other = await otherPerson(page.context().browser()!);
  await other.goto("/cadastro");
  await field(other, "Nome").fill("Outra Carla");
  await field(other, "E-mail").fill(email);
  await field(other, "Senha").fill(PASSWORD);
  await other.getByRole("button", { name: "Criar conta" }).filter({ visible: true }).last().click();
  await expect(other.getByRole("alert").filter({ hasText: "Este e-mail já tem uma conta" })).toBeVisible();
});

test("a new password, from the emailed link, signs out every other browser", async ({ page, browser }) => {
  const email = newEmail("bruno");
  await signUp(page, "Bruno Lima", email);

  const other = await otherPerson(browser);
  await other.goto("/entrar");
  await field(other, "E-mail").fill(email);
  await field(other, "Senha").fill("senha-errada");
  await other.getByRole("button", { name: "Entrar" }).filter({ visible: true }).last().click();
  await expect(other.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos." })).toBeVisible();
  await other.getByRole("link", { name: "Esqueci minha senha" }).click();
  // Until the new page shows, the sign-in form (with its own E-mail field) is still on screen.
  await expect(other.getByRole("heading", { name: "Esqueci minha senha" })).toBeVisible();
  await field(other, "E-mail").fill(email);
  await other.getByRole("button", { name: "Enviar link" }).click();
  await expect(other.getByText("o link já está a caminho")).toBeVisible();

  await other.goto(await emailedLink(email, "Redefina sua senha"));
  await field(other, "Nova senha").fill("nova-senha-789");
  await field(other, "Repita a senha").fill("nova-senha-789");
  await other.getByRole("button", { name: "Salvar e entrar" }).click();
  await expect(other.getByRole("heading", { name: "Olá, Bruno!" })).toBeVisible();

  // The first browser's session ended with the reset.
  await page.reload();
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconta/);
  await field(page, "E-mail").fill(email);
  await field(page, "Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).filter({ visible: true }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos." })).toBeVisible();
  await field(page, "Senha").fill("nova-senha-789");
  await page.getByRole("button", { name: "Entrar" }).filter({ visible: true }).last().click();
  await expect(page).toHaveURL("/conta");
});

test("a visitor sees the store and no session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Café especial, do grão à xícara." })).toBeVisible();
  await expect(page.getByText("Servidor online")).toBeVisible();
  const response = await page.request.get("/api/session");
  expect(await response.json()).toEqual({ me: null });
  await page.goto("/nao-existe");
  await expect(page.getByRole("heading", { name: "Não encontrado" })).toBeVisible();
});
