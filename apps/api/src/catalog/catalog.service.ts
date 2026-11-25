import { Injectable, NotFoundException } from "@nestjs/common";
import type { CatalogFilters, ProductDetail, ProductSummary } from "@torra/shared";
import { Prisma } from "../generated/prisma/client.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { visibleTo, visibleToSql } from "../sandbox/scope.ts";
import { Stock } from "./stock.service.ts";

interface SummaryRow {
  slug: string;
  title: string;
  subtitle: string;
  kind: "physical" | "digital";
  category: string;
  art: string;
  priceFromCents: number;
  priceToCents: number;
  soldOut: boolean;
}

/**
 * The storefront: active products of the shared catalog plus the viewer's own sandbox's, with prices and
 * availability as the viewer's corner of the store has them.
 */
@Injectable()
export class Catalog {
  constructor(
    private readonly db: PrismaService,
    private readonly stock: Stock,
  ) {}

  async list(
    viewer: { sandboxId: string | null } | null,
    filters: CatalogFilters,
  ): Promise<ProductSummary[]> {
    const sandboxId = viewer?.sandboxId ?? null;
    const query = filters.busca ? Prisma.sql`websearch_to_tsquery('pt_unaccent', ${filters.busca})` : null;
    const conditions = [Prisma.sql`p.active`, visibleToSql(viewer, `p."sandboxId"`)];
    if (filters.categoria) conditions.push(Prisma.sql`p.category = ${filters.categoria}`);
    if (query) conditions.push(Prisma.sql`p.search @@ ${query}`);
    const rows = await this.db.$queryRaw<SummaryRow[]>`
      SELECT p.slug, p.title, p.subtitle, p.kind, p.category, p.art,
             MIN(v."priceCents")::int AS "priceFromCents", MAX(v."priceCents")::int AS "priceToCents",
             (p.kind = 'physical' AND BOOL_AND(COALESCE(own.available, shared.available, 0) = 0)) AS "soldOut"
      FROM products p
      JOIN variants v ON v."productId" = p.id AND v.active
      LEFT JOIN stock_levels shared ON shared."variantId" = v.id AND shared."sandboxId" IS NULL
      LEFT JOIN stock_levels own ON own."variantId" = v.id AND own."sandboxId" = ${sandboxId}::uuid
      WHERE ${Prisma.join(conditions, " AND ")}
      GROUP BY p.id
      ORDER BY ${query ? Prisma.sql`ts_rank_cd(p.search, ${query}) DESC,` : Prisma.empty} p.position, p.title
      LIMIT 60`;
    return rows.map(({ priceToCents, ...row }) => ({
      ...row,
      priceVaries: priceToCents !== row.priceFromCents,
    }));
  }

  async detail(viewer: { sandboxId: string | null } | null, slug: string): Promise<ProductDetail> {
    const sandboxId = viewer?.sandboxId ?? null;
    // The shared product first, should a sandbox's own product ever reuse its slug (demo admins create
    // products in stage 7, where reusing a shared slug is refused).
    const product = await this.db.product.findFirst({
      where: { slug, active: true, ...visibleTo(viewer) },
      include: { variants: { where: { active: true }, orderBy: { position: "asc" } } },
      orderBy: { sandboxId: { sort: "asc", nulls: "first" } },
    });
    if (!product || product.variants.length === 0) {
      throw new NotFoundException({ code: "not_found", message: "Produto não encontrado." });
    }
    const available =
      product.kind === "physical"
        ? await this.stock.available(
            this.db,
            product.variants.map((v) => v.id),
            sandboxId,
          )
        : null;
    const variants = product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      optionValues: v.optionValues,
      priceCents: v.priceCents,
      compareAtCents: v.compareAtCents,
      weightGrams: v.weightGrams,
      available: available ? (available.get(v.id) ?? 0) : null,
    }));
    const prices = variants.map((v) => v.priceCents);
    return {
      slug: product.slug,
      title: product.title,
      subtitle: product.subtitle,
      kind: product.kind,
      category: product.category,
      art: product.art,
      description: product.description,
      optionNames: product.optionNames,
      priceFromCents: Math.min(...prices),
      priceVaries: new Set(prices).size > 1,
      soldOut: product.kind === "physical" && variants.every((v) => v.available === 0),
      variants,
    };
  }
}
