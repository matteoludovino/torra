import { expect, field, newEmail, signUp, test } from "./helpers";

const MAILPIT = process.env["MAILPIT_URL"] ?? "http://localhost:8026";

// End-to-end runs have no Stripe keys: the API's fake gateway stands in, and the order page shows its
// simulated card form. Its events go through the same path as Stripe's webhook.
test("pay for an order: a declined card, then an approved one; the receipt and the download", async ({
  page,
}) => {
  const email = newEmail("ana");
  await signUp(page, "Ana Souza", email);
  await page.goto("/produto/mantiqueira-bourbon-amarelo");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await page.goto("/produto/ebook-receitas-de-cafe-gelado");
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

  const payment = page.getByRole("region", { name: "Pagamento" });
  await expect(payment.getByText("Pagamento simulado")).toBeVisible();
  await payment.getByRole("button", { name: "Cartão recusado" }).click();
  await expect(payment.getByText("Seu cartão foi recusado.")).toBeVisible();
  await payment.getByRole("button", { name: "Aprovar pagamento" }).click();

  await expect(page.getByText(/Pagamento confirmado em/)).toBeVisible();
  await expect(page.getByText("Pago", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pagamento" })).toHaveCount(0);
  // The cart is empty now.
  await expect(page.getByRole("banner").getByRole("link", { name: /Carrinho/ })).not.toContainText(/\d/);

  // The e-book: a signed link that works without the page's session.
  const link = page.getByRole("link", { name: /Baixar E-book 30 receitas de café gelado/ });
  const href = (await link.getAttribute("href"))!;
  const file = await page.request.get(href);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const { messages } = (await search.json()) as { messages: { Subject: string }[] };
        return messages
          .map((message) => message.Subject)
          .filter((subject) => subject.startsWith("Pagamento"));
      },
      { timeout: 15_000 },
    )
    .toHaveLength(1);
});

test("an order left processing settles on its own when the payment does", async ({ page }) => {
  await signUp(page, "Caio Reis", newEmail("caio"));
  await page.goto("/produto/curso-cafe-coado-em-casa");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Adicionado." })).toBeVisible();
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Ir para o pagamento" }).click();
  const payment = page.getByRole("region", { name: "Pagamento" });
  await payment.getByRole("button", { name: "Deixar em processamento" }).click();
  await expect(page.getByText("Seu pagamento está em processamento.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);

  // The bank confirms (here: the simulated card, through the API); the page notices by itself.
  const orderId = page.url().split("/").pop()!;
  const settled = await page.request.post(`/api/orders/${orderId}/payment/simulate`, {
    data: { outcome: "succeed" },
    headers: { origin: "http://localhost:3040" },
  });
  expect(settled.status()).toBe(200);
  await expect(page.getByText(/Pagamento confirmado em/)).toBeVisible({ timeout: 25_000 });
});
