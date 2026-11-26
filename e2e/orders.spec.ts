import { expect, field, newEmail, signUp, test } from "./helpers";

const MAILPIT = process.env["MAILPIT_URL"] ?? "http://localhost:8026";

/** Subjects of the emails sent to an address (waits until one contains `subject`). */
async function waitForEmail(to: string, subject: string) {
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await search.json()) as { messages: { Subject: string }[] };
        return messages.some((message) => message.Subject.includes(subject));
      },
      { timeout: 15_000, message: `email "${subject}" to ${to}` },
    )
    .toBe(true);
}

test("check out: address, shipping and coupon, then the order; change it, then cancel it", async ({
  page,
}) => {
  const email = newEmail("ana");
  await signUp(page, "Ana Souza", email);

  await page.goto("/produto/mantiqueira-bourbon-amarelo");
  await page.getByLabel("Quantidade").selectOption("2");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await page.goto("/carrinho");
  await page.getByRole("textbox", { name: "Cupom de desconto" }).fill("bemvindo10");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("BEMVINDO10")).toBeVisible();
  await page.getByRole("link", { name: "Continuar" }).click();

  // The postal directory doesn't answer in these tests: the address is typed in, state included.
  await expect(page.getByRole("heading", { name: "Finalizar compra" })).toBeVisible();
  await expect(field(page, "Quem recebe")).toHaveValue("Ana Souza");
  await field(page, "CEP").fill("01310-100");
  await expect(page.getByText("A busca de CEP não respondeu: preencha o endereço.")).toBeVisible();
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  await expect(page.getByText("Preencha este campo.").first()).toBeVisible();
  await field(page, "Rua").fill("Avenida Paulista");
  await field(page, "Número").fill("1000");
  await field(page, "Bairro").fill("Bela Vista");
  await field(page, "Cidade").fill("São Paulo");
  await field(page, "UF").selectOption("SP");
  await page.getByRole("radio", { name: /Expresso/ }).click();
  await expect(page.getByRole("radio", { name: /Expresso/ })).toBeChecked();
  // R$ 98,00 − R$ 9,80 + R$ 34,90.
  await expect(page.getByRole("complementary").getByText("R$ 123,10")).toBeVisible();
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();

  await expect(page.getByRole("heading", { name: /Pedido #\d+/ })).toBeVisible();
  const first = (await page.getByRole("heading", { name: /Pedido #\d+/ }).textContent())!;
  await expect(page.getByText(/Os itens ficam guardados para você por mais \d+:\d\d/)).toBeVisible();
  await expect(page.getByText("Frete (Expresso)")).toBeVisible();
  await expect(page.getByRole("region", { name: "Itens" }).getByText("R$ 123,10")).toBeVisible();
  await waitForEmail(email, `Recebemos seu pedido ${first.replace("Pedido ", "")}`);

  // Back at checkout everything is as it was, coupon included; cheaper shipping makes a new order.
  await page.goto("/checkout");
  await expect(field(page, "Rua")).toHaveValue("Avenida Paulista");
  await expect(page.getByText("BEMVINDO10")).toBeVisible();
  await page.getByRole("radio", { name: /Econômico/ }).click();
  await expect(page.getByRole("radio", { name: /Econômico/ })).toBeChecked();
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  await expect(page.getByRole("heading", { name: /Pedido #\d+/ })).not.toHaveText(first);
  await expect(page.getByText("Frete (Econômico)")).toBeVisible();

  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Os itens voltam para o estoque");
  await dialog.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.getByText("Pedido cancelado: nada foi cobrado.")).toBeVisible();
  await expect(page.getByText("Cancelado · por você")).toBeVisible();

  // The account lists both; the first one says it was replaced.
  await page.goto("/conta");
  const orders = page.getByRole("link", { name: /^#\d+ Cancelado/ });
  await expect(orders).toHaveCount(2);
  await orders.last().click();
  await expect(page.getByText("Este pedido foi substituído por um mais recente")).toBeVisible();
});

test("a visitor is asked to sign in on the way to checkout, and digital products need no address", async ({
  page,
}) => {
  await page.goto("/produto/curso-cafe-coado-em-casa");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await page.goto("/carrinho");
  await page.getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/entrar\?next=%2Fcheckout|\/entrar\?next=\/checkout/);

  await signUp(page, "Caio Reis", newEmail("caio"));
  await page.goto("/checkout");
  await expect(page.getByText("Só produtos digitais: nada para entregar.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Endereço de entrega" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  await expect(page.getByRole("heading", { name: /Pedido #\d+/ })).toBeVisible();
  await expect(page.getByText("Produto digital")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Entrega" })).toHaveCount(0);
});
