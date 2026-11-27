import { expect, test } from "./helpers";

test("one click into a demo: its orders appear, one is paid, then the same demo as its admin", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Entrar como cliente/ }).click();
  await expect(page).toHaveURL("/conta");
  const banner = page.getByText("Demonstração", { exact: true });
  await expect(banner).toBeVisible();

  // The story arrives in the background: delivered, paid, and one waiting for payment.
  const orders = page.getByRole("link", { name: /^#\d+ / });
  await expect(orders).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Entregue/ })).toBeVisible();
  await page.getByRole("link", { name: /Aguardando pagamento/ }).click();
  await page
    .getByRole("region", { name: "Pagamento" })
    .getByRole("button", { name: "Aprovar pagamento" })
    .click();
  await expect(page.getByText(/Pagamento confirmado em/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Seus downloads" })).toBeVisible();

  // The demo's emails stay in the demo.
  await page.getByRole("link", { name: "E-mails da demo" }).click();
  await expect(page.getByText(/Pagamento confirmado: pedido #\d+/).first()).toBeVisible();

  // The other persona, same demo: its panel shows the same three orders, scoped to the demo.
  await page.getByRole("button", { name: "Trocar para admin" }).click();
  await expect(page.getByRole("heading", { name: "Painel da demo" })).toBeVisible();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(page.getByRole("link", { name: /Marina Costa/ })).toHaveCount(3);
});
