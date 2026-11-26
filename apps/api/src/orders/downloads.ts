import { GoneException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { uuidv7 } from "../common/ids.ts";
import { ENV, type Env } from "../env.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";
import { simplePdf } from "./pdf.ts";

/** A download link works for this long (the order's page makes a fresh one each time it's opened). */
export const DOWNLOAD_TTL_MS = 60 * 60_000;

const PAID = ["paid", "preparing", "shipped", "delivered"] as const;
const NOT_FOUND = { code: "not_found", message: "Download não encontrado." };

/**
 * Downloads of purchased digital items. The link is "<item>.<expiry>.<HMAC>": it needs no session (it
 * opens anywhere, as a plain link), proves it came from us, and stops working after an hour. The order
 * must still be paid when it's used; each download is counted.
 *
 * The file is made on request: the product's material, licensed to the buyer by name and order number
 * (the free host has no disk to keep files on, and a personal copy discourages passing it around).
 */
@Injectable()
export class Downloads {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The link to an order item's file, valid for an hour from now. */
  link(orderItemId: string): string {
    const expires = this.clock.now().getTime() + DOWNLOAD_TTL_MS;
    return `/api/downloads/${orderItemId}.${expires}.${this.mac(orderItemId, expires)}`;
  }

  async file(token: string): Promise<{ name: string; body: Buffer }> {
    const [itemId, expiresText, mac, extra] = token.split(".");
    const expires = Number(expiresText);
    if (!itemId || !mac || extra !== undefined || !Number.isSafeInteger(expires)) {
      throw new NotFoundException(NOT_FOUND);
    }
    const expected = Buffer.from(this.mac(itemId, expires));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new NotFoundException(NOT_FOUND);
    }
    const now = this.clock.now();
    if (expires <= now.getTime()) {
      throw new GoneException({
        code: "link_expired",
        message: "Este link expirou: abra o pedido de novo para baixar.",
      });
    }
    const item = await this.db.orderItem.findFirst({
      where: { id: itemId, kind: "digital", order: { status: { in: [...PAID] } } },
      include: { order: { include: { user: true } }, variant: { include: { product: true } } },
    });
    if (!item) throw new NotFoundException(NOT_FOUND);
    await this.db.download.create({
      data: { id: uuidv7(now.getTime()), orderItemId: item.id, createdAt: now },
    });

    const { product } = item.variant;
    const body = simplePdf([
      { text: "Torra · Cafés especiais", size: 10 },
      { text: item.title, size: 22, bold: true, gap: 18 },
      { text: product.subtitle, size: 12, gap: 4 },
      {
        text: `Licenciado para ${item.order.user.name} · pedido #${item.order.number}. Uso pessoal.`,
        size: 9,
        gap: 10,
      },
      ...product.description
        .split(/\n+/)
        .filter(Boolean)
        .map((paragraph) => ({ text: paragraph, gap: 10 })),
      {
        text: "Material de demonstração: a Torra é uma loja fictícia, feita para mostrar um checkout com Stripe em modo de teste.",
        size: 9,
        gap: 24,
      },
    ]);
    return { name: `${product.slug}.pdf`, body };
  }

  private mac(itemId: string, expires: number): string {
    return createHmac("sha256", this.env.SIGNING_SECRET)
      .update(`download:${itemId}:${expires}`)
      .digest("base64url");
  }
}
