import { PASSWORD, field, newEmail, expect, test } from "./helpers";

test("fill a cart as a visitor, change it, then sign up and keep it", async ({ page }) => {
  const header = page.getByRole("banner");

  await page.goto("/produto/coador-conico-ceramica-02");
  await expect(page.getByRole("heading", { name: "Coador cônico de cerâmica 02" })).toBeVisible();
  await page.getByLabel("Quantidade").selectOption("2");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await expect(header.getByRole("link", { name: /Carrinho.*2 itens/ })).toBeVisible();

  // The black one has only two: asking for a third says so.
  await page.getByRole("radio", { name: "Preto" }).check({ force: true });
  await expect(page.getByText("Últimas 2 unidades")).toBeVisible();
  await page.getByLabel("Quantidade").selectOption("2");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(header.getByRole("link", { name: /Carrinho.*4 itens/ })).toBeVisible();
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByText("Só há 2 em estoque.")).toBeVisible();

  await page.goto("/produto/curso-cafe-coado-em-casa");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(header.getByRole("link", { name: /Carrinho.*5 itens/ })).toBeVisible();

  await header.getByRole("link", { name: /Carrinho/ }).click();
  await expect(page.getByRole("heading", { name: "Carrinho" })).toBeVisible();
  const lines = page.getByRole("region", { name: "Itens" }).getByRole("listitem");
  await expect(lines).toHaveCount(3);
  await expect(page.getByText("R$ 613,00")).toBeVisible(); // 2 × 129 + 2 × 129 + 97
  const black = lines.filter({ hasText: "Preto" });
  await black.getByLabel("Qtd.").selectOption("1");
  await expect(page.getByText("R$ 484,00")).toBeVisible();
  await lines
    .filter({ hasText: "Curso Café Coado em Casa" })
    .getByRole("button", { name: "Remover" })
    .click();
  await expect(lines).toHaveCount(2);
  await expect(page.getByText("R$ 387,00")).toBeVisible();

  // Signing up takes the cart along.
  await page.goto("/cadastro");
  await field(page, "Nome").fill("Bia Lima");
  await field(page, "E-mail").fill(newEmail("bia"));
  await field(page, "Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).filter({ visible: true }).last().click();
  await expect(page.getByRole("heading", { name: "Olá, Bia!" })).toBeVisible();
  await expect(header.getByRole("link", { name: /Carrinho.*3 itens/ })).toBeVisible();
  await header.getByRole("link", { name: /Carrinho/ }).click();
  await expect(page.getByText("R$ 387,00")).toBeVisible();
});
