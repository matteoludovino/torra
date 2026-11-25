import { expect, test } from "./helpers";

test("browse the shelves, search without accents, pick a variant and see what's left", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cafés", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mantiqueira de Minas · Bourbon Amarelo" })).toBeVisible();

  await page.getByRole("link", { name: "Ver a loja" }).click();
  await expect(page.getByRole("heading", { name: "Loja" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Buscar na loja" });
  await search.fill("ceramica");
  await search.press("Enter");
  await expect(page).toHaveURL(/busca=ceramica/);
  const result = page.getByRole("link", { name: "Coador cônico de cerâmica 02" }).filter({ visible: true });
  await expect(result).toHaveCount(1);

  await page.goto("/produto/caparao-natural-fermentado");
  await expect(page.getByRole("heading", { name: "Caparaó · Natural fermentado (microlote)" })).toBeVisible();
  await expect(page.getByText("R$ 69,00")).toBeVisible();
  await expect(page.getByText("Últimas 3 unidades")).toBeVisible();
  await page.getByRole("radio", { name: /^500 g/ }).check({ force: true });
  await expect(page.getByText("R$ 129,00")).toBeVisible();
  await page.getByRole("radio", { name: /^1 kg/ }).check({ force: true });
  await expect(page.getByText("Esgotado nesta opção.")).toBeVisible();

  await page.goto("/produto/curso-espresso-do-zero");
  await expect(page.getByText("acesso liberado assim que o pagamento é aprovado")).toBeVisible();
  await expect(page.getByText("R$ 247,00")).toBeVisible(); // the former price, struck through
  await page.goto("/produto/nao-existe");
  await expect(page.getByRole("heading", { name: "Não encontrado" })).toBeVisible();
});
