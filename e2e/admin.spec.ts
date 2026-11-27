import type { Page } from "@playwright/test";
import { createAdmin, expect, field, newEmail, otherPerson, signUp, test } from "./helpers";

const MAILPIT = process.env["MAILPIT_URL"] ?? "http://localhost:8026";

/** A store admin, made the only way there is (the command line), signed in through the emailed link. */
async function signInAsAdmin(page: Page) {
  await page.goto(createAdmin(newEmail("equipe")));
  await field(page, "Nova senha").fill("senha-da-equipe-123");
  await field(page, "Repita a senha").fill("senha-da-equipe-123");
  await page.getByRole("button", { name: "Salvar e entrar" }).click();
  await expect(
    page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Admin" }),
  ).toBeVisible();
}

/** A customer's paid order (simulated card), with something to ship; returns its number. */
async function paidOrder(page: Page, email: string): Promise<string> {
  await signUp(page, "Ana Souza", email);
  await page.goto("/produto/mantiqueira-bourbon-amarelo");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await page.goto("/checkout");
  await field(page, "CEP").fill("01310-100");
  await field(page, "Rua").fill("Avenida Paulista");
  await field(page, "Número").fill("1000");
  await field(page, "Bairro").fill("Bela Vista");
  await field(page, "Cidade").fill("São Paulo");
  await field(page, "UF").selectOption("SP");
  await expect(page.getByRole("radio", { name: /Econômico/ })).toBeChecked();
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  await page
    .getByRole("region", { name: "Pagamento" })
    .getByRole("button", { name: "Aprovar pagamento" })
    .click();
  await expect(page.getByText(/Pagamento confirmado em/)).toBeVisible();
  return (await page.getByRole("heading", { name: /Pedido #\d+/ }).textContent())!.replace("Pedido ", "");
}

test("ship a paid order from the panel; the customer follows it and is told", async ({ page, browser }) => {
  const email = newEmail("ana");
  const number = await paidOrder(page, email);
  const orderUrl = page.url();

  const admin = await otherPerson(browser);
  await signInAsAdmin(admin);
  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "Painel da loja" })).toBeVisible();
  await admin.getByRole("link", { name: /A enviar/ }).click();
  await admin.getByRole("link", { name: new RegExp(`^${number} Ana Souza`) }).click();

  await admin.getByRole("button", { name: "Começar a preparar" }).click();
  await field(admin, "Código de rastreio").fill("qb 123 456 789 br");
  await admin.getByRole("button", { name: "Marcar como enviado" }).click();
  await expect(admin.getByText("Rastreio: QB123456789BR")).toBeVisible();
  await admin.getByRole("button", { name: "Marcar como entregue" }).click();
  await expect(admin.getByText("Entregue", { exact: true }).first()).toBeVisible();

  // The customer's page shows the history, and the emails went out.
  await page.goto(orderUrl);
  await expect(page.getByText("Enviado · QB123456789BR")).toBeVisible();
  await expect(page.getByText("Entregue", { exact: true }).first()).toBeVisible();
  await expect
    .poll(async () => {
      const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      const { messages } = (await search.json()) as { messages: { Subject: string }[] };
      return messages.map((message) => message.Subject);
    })
    .toEqual(expect.arrayContaining([`Seu pedido ${number} foi enviado`, `Pedido ${number} entregue`]));

  // The audit log has every step.
  await admin.goto("/admin/registro");
  await expect(admin.getByText(`Enviou o pedido ${number} QB123456789BR`)).toBeVisible();
  await expect(admin.getByText(`Começou a preparar o pedido ${number}`)).toBeVisible();
});

test("add a product, correct its stock, make a coupon; customers see them", async ({ page, browser }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/produtos/novo");
  await page.getByRole("radio", { name: /Físico/ }).check();
  await field(page, "Nome").fill("Jarra de vidro térmica");
  await field(page, "Categoria").selectOption({ label: "Utensílios" });
  await field(page, "Resumo").fill("Para servir o café coado.");
  await field(page, "Descrição").fill("Uma jarra de vidro de parede dupla, que mantém o café quente.");
  await field(page, "Ilustração").selectOption({ label: "Chaleira" });
  await field(page, "SKU").fill(`jarra-${Date.now()}`);
  await field(page, "Preço").fill("89,00");
  await field(page, "Peso (g)").fill("520");
  await field(page, "Estoque inicial").fill("3");
  await page.getByRole("button", { name: "Criar produto" }).click();

  const product = page
    .locator("section", { has: page.getByRole("heading", { name: "Jarra de vidro térmica" }) })
    .last();
  await expect(product).toBeVisible();
  await product.getByRole("button", { name: "Ajustar estoque" }).click();
  const dialog = page.getByRole("dialog");
  await field(page, "Unidades (positivo entra, negativo sai)").fill("-5");
  await field(page, "Motivo").fill("Contagem");
  await dialog.getByRole("button", { name: "Ajustar" }).click();
  await expect(dialog.getByText(/O estoque ficaria negativo/)).toBeVisible();
  await field(page, "Unidades (positivo entra, negativo sai)").fill("-1");
  await dialog.getByRole("button", { name: "Ajustar" }).click();
  await expect(dialog).toBeHidden();
  await expect(product.getByRole("cell", { name: "2", exact: true })).toBeVisible();

  const code = `JARRA${Date.now() % 100000}`;
  await page.goto("/admin/cupons");
  await field(page, "Código").fill(code);
  await field(page, "Tipo").selectOption({ label: "Valor fixo" });
  await field(page, "Desconto (R$)").fill("10,00");
  await page.getByRole("button", { name: "Criar cupom" }).click();
  await expect(page.getByText(`Cupom ${code} criado.`)).toBeVisible();

  // A visitor finds the product with its stock, and the coupon works on the cart.
  const visitor = await otherPerson(browser);
  await visitor.goto("/loja?q=jarra%20termica");
  await visitor
    .getByRole("link", { name: /Jarra de vidro térmica/ })
    .first()
    .click();
  await expect(visitor.getByText("Últimas 2 unidades")).toBeVisible();
  await visitor.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(visitor.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await visitor.goto("/carrinho");
  await visitor.getByRole("textbox", { name: "Cupom de desconto" }).fill(code.toLowerCase());
  await visitor.getByRole("button", { name: "Aplicar" }).click();
  await expect(visitor.getByRole("complementary").getByText("− R$ 10,00")).toBeVisible();
});

test("isn't for customers", async ({ page }) => {
  await signUp(page, "Caio Reis", newEmail("caio"));
  await page.goto("/admin");
  await expect(page.getByText("Esta área é só para a equipe da loja.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Seções do painel" })).toHaveCount(0);
});

test("refund part of an order, then cancel the rest; the customer sees what came back", async ({
  page,
  browser,
}) => {
  const email = newEmail("ana");
  const number = await paidOrder(page, email);
  const orderUrl = page.url();

  const admin = await otherPerson(browser);
  await signInAsAdmin(admin);
  await admin.goto("/admin/pedidos");
  await admin.getByRole("link", { name: new RegExp(`^${number} Ana Souza`) }).click();

  // The shipping back, as a goodwill gesture.
  await admin.getByRole("checkbox", { name: /Frete/ }).check();
  await field(admin, "Motivo").fill("Atraso na entrega");
  await admin.getByRole("button", { name: "Reembolsar R$ 19,90" }).click();
  await expect(admin.getByText("Atraso na entrega")).toBeVisible();
  await expect(admin.getByText("Reembolsado", { exact: true }).first()).toBeVisible();

  // Then the order itself, before it ships: everything else back.
  await admin.getByRole("button", { name: "Cancelar e reembolsar" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(admin.getByText("Cancelado", { exact: true }).first()).toBeVisible();

  await page.goto(orderUrl);
  await expect(
    page.getByText("Pedido cancelado pela loja: o valor pago foi devolvido ao cartão."),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Itens" }).getByText("− R$ 68,90")).toBeVisible();
  await expect
    .poll(async () => {
      const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      const { messages } = (await search.json()) as { messages: { Subject: string }[] };
      return messages.filter((message) => message.Subject.startsWith("Reembolso")).length;
    })
    .toBe(2);
});
