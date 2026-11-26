import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { formatBRL } from "@torra/shared";
import { ENV, type Env } from "../env.ts";
import { Mailer } from "../mail/mailer.service.ts";
import { update } from "../mail/templates.ts";
import { OutboxService } from "../outbox/outbox.service.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { ORDER_EVENTS } from "./orders.service.ts";

/**
 * Email about orders, sent from the outbox. "We got your order" is a receipt (always sent); the expiry
 * notice is an order update people can turn off.
 */
@Injectable()
export class OrderEmails implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly outbox: OutboxService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.outbox.handle(ORDER_EVENTS.placed, async ({ payload }) => {
      const order = await this.order(payload);
      if (!order) return;
      const items = order.items.map(
        (item) => `${item.quantity} × ${item.title}${item.options ? ` (${item.options})` : ""}`,
      );
      await this.mailer.send(
        this.recipient(order),
        "order_placed",
        update(
          order.user.name,
          `Recebemos seu pedido #${order.number}`,
          [
            `Seu pedido #${order.number} foi registrado: ${items.join("; ")}.`,
            `Total: ${formatBRL(order.totalCents)}. Os itens ficam guardados para você por 30 minutos, enquanto o pagamento não é concluído.`,
          ],
          { label: "Ver o pedido", url: this.link(order.id) },
        ),
      );
    });
    this.outbox.handle(ORDER_EVENTS.expired, async ({ payload }) => {
      const order = await this.order(payload);
      if (!order || order.status !== "expired") return;
      await this.mailer.send(
        this.recipient(order),
        "order_progress_expired",
        update(
          order.user.name,
          `Seu pedido #${order.number} expirou`,
          [
            `O pagamento do pedido #${order.number} não foi concluído em 30 minutos, então os itens voltaram para o estoque e nada foi cobrado.`,
            "Seu carrinho continua do jeito que estava: é só voltar e finalizar a compra.",
          ],
          { label: "Ir para o carrinho", url: new URL("/carrinho", this.env.WEB_URL).href },
        ),
      );
    });
  }

  private order(payload: unknown) {
    const { orderId } = payload as { orderId: string };
    return this.db.order.findUnique({
      where: { id: orderId },
      include: { user: true, items: { orderBy: { position: "asc" } } },
    });
  }

  private link(orderId: string): string {
    return new URL(`/pedidos/${orderId}`, this.env.WEB_URL).href;
  }

  private recipient(order: { userId: string; email: string; sandboxId: string }) {
    return { userId: order.userId, email: order.email, sandboxId: order.sandboxId };
  }
}
