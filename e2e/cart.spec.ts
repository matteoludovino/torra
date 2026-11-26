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
  await expect(page.getByText("R$ 613,00").first()).toBeVisible(); // 2 × 129 + 2 × 129 + 97
  const black = lines.filter({ hasText: "Preto" });
  await black.getByLabel("Qtd.").selectOption("1");
  await expect(page.getByText("R$ 484,00").first()).toBeVisible();
  await lines
    .filter({ hasText: "Curso Café Coado em Casa" })
    .getByRole("button", { name: "Remover" })
    .click();
  await expect(lines).toHaveCount(2);
  await expect(page.getByText("R$ 387,00").first()).toBeVisible();

  // Signing up takes the cart along.
  await page.goto("/cadastro");
  await field(page, "Nome").fill("Bia Lima");
  await field(page, "E-mail").fill(newEmail("bia"));
  await field(page, "Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).filter({ visible: true }).last().click();
  await expect(page.getByRole("heading", { name: "Olá, Bia!" })).toBeVisible();
  await expect(header.getByRole("link", { name: /Carrinho.*3 itens/ })).toBeVisible();
  await header.getByRole("link", { name: /Carrinho/ }).click();
  await expect(page.getByText("R$ 387,00").first()).toBeVisible();
});

test("price shipping to a CEP (the state picked by hand when the directory is down) and apply a coupon", async ({
  page,
}) => {
  await page.goto("/produto/mantiqueira-bourbon-amarelo");
  await expect(page.getByRole("heading", { name: "Mantiqueira de Minas · Bourbon Amarelo" })).toBeVisible();
  await page.getByLabel("Quantidade").selectOption("3");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await page.goto("/carrinho");

  await page.getByRole("textbox", { name: "CEP" }).fill("01310-100");
  await page.getByRole("button", { name: "Calcular" }).click();
  await page.getByLabel("A busca de CEP não respondeu. Escolha o estado:").selectOption("SP");
  await expect(page.getByText("4 a 6 dias úteis")).toBeVisible();
  // The choice shows once the server has priced it.
  await page.getByRole("radio", { name: /Expresso/ }).click();
  await expect(page.getByRole("radio", { name: /Expresso/ })).toBeChecked();

  await page.getByRole("textbox", { name: "Cupom de desconto" }).fill("naoexiste");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Cupom não encontrado.")).toBeVisible();
  await page.getByRole("textbox", { name: "Cupom de desconto" }).fill("bemvindo10");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("BEMVINDO10")).toBeVisible();

  // R$ 147,00 − R$ 14,70 + R$ 34,90 (Expresso, first kilo, to the Southeast).
  const totals = page.getByRole("complementary");
  await expect(totals.getByText("− R$ 14,70")).toBeVisible();
  await expect(totals.getByText("R$ 167,20")).toBeVisible();
});
