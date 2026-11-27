import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminProduct, AdminVariant } from "@torra/shared";
import type { z } from "zod";
import type {
  productInput,
  productUpdate,
  stockAdjustment,
  variantInput,
  variantUpdate,
} from "@torra/shared";
import { OutOfStock, Stock } from "../catalog/stock.service.ts";
import { uuidv7 } from "../common/ids.ts";
import { isUniqueViolation, transaction } from "../common/transactions.ts";
import type { Tx } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { visibleTo } from "../sandbox/scope.ts";
import { Clock } from "../time/clock.ts";
import { Audit } from "./audit.ts";
import { ownedBy, type Admin } from "./scope.ts";

type ProductInput = z.infer<typeof productInput>;
type VariantInput = z.infer<typeof variantInput>;

const NOT_FOUND = { code: "not_found", message: "Produto não encontrado." };
const VARIANT_NOT_FOUND = { code: "not_found", message: "Variante não encontrada." };
const SKU_TAKEN = { code: "sku_taken", message: "Já existe uma variante com este SKU." };

/**
 * The catalog, as admins change it. The store's admins change the shared catalog and its stock; a demo's
 * admin adds products of its own (seen only in that demo), and corrects its own copy of any stock, but
 * never changes what everyone else sees. Every change goes to the audit log.
 */
@Injectable()
export class AdminCatalog {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly stock: Stock,
    private readonly audit: Audit,
  ) {}

  async list(admin: Admin): Promise<AdminProduct[]> {
    const products = await this.db.product.findMany({
      where: visibleTo(admin),
      include: { variants: { orderBy: [{ position: "asc" }, { sku: "asc" }] } },
      orderBy: [{ category: "asc" }, { position: "asc" }, { title: "asc" }],
    });
    const physical = products.flatMap((product) =>
      product.kind === "physical" ? product.variants.map((variant) => variant.id) : [],
    );
    const available = await this.stock.available(this.db, physical, admin.sandboxId);
    return products.map((product) => ({
      id: product.id,
      slug: product.slug,
      kind: product.kind,
      category: product.category,
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      art: product.art,
      optionNames: product.optionNames,
      active: product.active,
      editable: product.sandboxId === admin.sandboxId,
      own: product.sandboxId !== null,
      variants: product.variants.map((variant): AdminVariant => ({
        id: variant.id,
        sku: variant.sku,
        optionValues: variant.optionValues,
        priceCents: variant.priceCents,
        compareAtCents: variant.compareAtCents,
        weightGrams: variant.weightGrams,
        active: variant.active,
        available: product.kind === "physical" ? (available.get(variant.id) ?? 0) : null,
      })),
    }));
  }

  /** A new product with its variants (and, for physical ones, the stock they start with). */
  async create(admin: Admin, input: ProductInput): Promise<AdminProduct> {
    const id = uuidv7(this.clock.now().getTime());
    await this.guard(() =>
      transaction(this.db, async (tx) => {
        const slug = await this.freeSlug(tx, admin, slugify(input.title));
        const last = await tx.product.aggregate({
          where: { category: input.category },
          _max: { position: true },
        });
        await tx.product.create({
          data: {
            id,
            sandboxId: admin.sandboxId,
            slug,
            kind: input.kind,
            category: input.category,
            title: input.title,
            subtitle: input.subtitle,
            description: input.description,
            art: input.art,
            optionNames: input.optionNames,
            position: (last._max.position ?? 0) + 1,
          },
        });
        for (const [position, variant] of input.variants.entries()) {
          await this.addVariantIn(
            tx,
            admin,
            { id, kind: input.kind, optionNames: input.optionNames },
            variant,
            position,
          );
        }
        await this.audit.record(
          tx,
          admin.user,
          "product.create",
          { type: "product", id },
          {
            title: input.title,
            variants: input.variants.length,
          },
        );
      }),
    );
    return this.one(admin, id);
  }

  async update(admin: Admin, id: string, input: z.infer<typeof productUpdate>): Promise<AdminProduct> {
    await transaction(this.db, async (tx) => {
      const { count } = await tx.product.updateMany({ where: { id, ...ownedBy(admin) }, data: input });
      if (count === 0) throw new NotFoundException(NOT_FOUND);
      await this.audit.record(tx, admin.user, "product.update", { type: "product", id }, input);
    });
    return this.one(admin, id);
  }

  async addVariant(admin: Admin, productId: string, input: VariantInput): Promise<AdminProduct> {
    await this.guard(() =>
      transaction(this.db, async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, ...ownedBy(admin) },
          include: { _count: { select: { variants: true } } },
        });
        if (!product) throw new NotFoundException(NOT_FOUND);
        const variantId = await this.addVariantIn(tx, admin, product, input, product._count.variants);
        await this.audit.record(
          tx,
          admin.user,
          "variant.create",
          { type: "variant", id: variantId },
          {
            sku: input.sku,
            productId,
          },
        );
      }),
    );
    return this.one(admin, productId);
  }

  async updateVariant(admin: Admin, id: string, input: z.infer<typeof variantUpdate>): Promise<AdminProduct> {
    const variant = await this.db.variant.findFirst({
      where: { id, ...ownedBy(admin) },
      include: { product: true },
    });
    if (!variant) throw new NotFoundException(VARIANT_NOT_FOUND);
    if (input.weightGrams !== undefined && variant.product.kind !== "physical") {
      throw new BadRequestException({ code: "digital_weight", message: "Produtos digitais não têm peso." });
    }
    const price = input.priceCents ?? variant.priceCents;
    const compareAt = input.compareAtCents === undefined ? variant.compareAtCents : input.compareAtCents;
    if (compareAt !== null && compareAt <= price) {
      throw new BadRequestException({
        code: "compare_at",
        message: "O preço “de” precisa ser maior que o preço atual.",
      });
    }
    await transaction(this.db, async (tx) => {
      await tx.variant.update({ where: { id }, data: input });
      await this.audit.record(
        tx,
        admin.user,
        "variant.update",
        { type: "variant", id },
        {
          sku: variant.sku,
          ...input,
        },
      );
    });
    return this.one(admin, variant.productId);
  }

  /**
   * Corrects stock in the admin's corner: the shared stock for the store's admins, the demo's own copy
   * for a demo's (copied from the shared one on first touch, as for customers). Never below zero.
   */
  async adjustStock(
    admin: Admin,
    variantId: string,
    input: z.infer<typeof stockAdjustment>,
  ): Promise<AdminProduct> {
    const variant = await this.db.variant.findFirst({
      where: { id: variantId, ...visibleTo(admin) },
      include: { product: true },
    });
    if (!variant) throw new NotFoundException(VARIANT_NOT_FOUND);
    if (variant.product.kind !== "physical") {
      throw new BadRequestException({ code: "digital_stock", message: "Produtos digitais não têm estoque." });
    }
    try {
      await transaction(this.db, async (tx) => {
        await this.stock.move(tx, {
          variantId,
          sandboxId: admin.sandboxId,
          kind: "adjust",
          quantity: input.quantity,
          reason: input.reason,
          actorId: admin.user.id,
        });
        await this.audit.record(
          tx,
          admin.user,
          "stock.adjust",
          { type: "variant", id: variantId },
          {
            sku: variant.sku,
            quantity: input.quantity,
            reason: input.reason,
          },
        );
      });
    } catch (error) {
      if (!(error instanceof OutOfStock)) throw error;
      throw new ConflictException({
        code: "below_zero",
        message: "O estoque ficaria negativo: há menos unidades do que a saída informada.",
      });
    }
    return this.one(admin, variant.productId);
  }

  private async one(admin: Admin, id: string): Promise<AdminProduct> {
    const product = (await this.list(admin)).find((candidate) => candidate.id === id);
    if (!product) throw new NotFoundException(NOT_FOUND);
    return product;
  }

  private async addVariantIn(
    tx: Tx,
    admin: Admin,
    product: { id: string; kind: "physical" | "digital"; optionNames: string[] },
    input: VariantInput,
    position: number,
  ): Promise<string> {
    if (input.optionValues.length !== product.optionNames.length) {
      throw new BadRequestException({
        code: "option_values",
        message: `Cada variante precisa de ${product.optionNames.length} opção(ões): ${product.optionNames.join(", ") || "nenhuma"}.`,
      });
    }
    const physical = product.kind === "physical";
    if (physical !== (input.weightGrams !== null)) {
      throw new BadRequestException({
        code: "weight",
        message: physical
          ? "Informe o peso (com embalagem) de cada variante."
          : "Produtos digitais não têm peso.",
      });
    }
    if (input.compareAtCents !== null && input.compareAtCents <= input.priceCents) {
      throw new BadRequestException({
        code: "compare_at",
        message: "O preço “de” precisa ser maior que o preço atual.",
      });
    }
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    await tx.variant.create({
      data: {
        id,
        productId: product.id,
        sandboxId: admin.sandboxId,
        sku: input.sku,
        optionValues: input.optionValues,
        priceCents: input.priceCents,
        compareAtCents: input.compareAtCents,
        weightGrams: input.weightGrams,
        position,
      },
    });
    if (physical && input.initialStock > 0) {
      await this.stock.move(tx, {
        variantId: id,
        sandboxId: admin.sandboxId,
        kind: "seed",
        quantity: input.initialStock,
        actorId: admin.user.id,
      });
    }
    return id;
  }

  /** The title's slug, or with a number after it if this corner of the store already has it. */
  private async freeSlug(tx: Tx, admin: Admin, base: string): Promise<string> {
    const taken = new Set(
      (
        await tx.product.findMany({
          where: { slug: { startsWith: base }, ...visibleTo(admin) },
          select: { slug: true },
        })
      ).map((product) => product.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** A SKU taken in this corner of the store (unique per sandbox): a 409 that says so. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(SKU_TAKEN);
      throw error;
    }
  }
}

/** "Moedor manual com mós de aço" → "moedor-manual-com-mos-de-aco". */
export function slugify(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70)
      .replace(/-+$/, "") || "produto"
  );
}
