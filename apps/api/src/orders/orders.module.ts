import { Module } from "@nestjs/common";
import { CartsModule } from "../cart/carts.module.ts";
import { CatalogModule } from "../catalog/catalog.module.ts";
import { CheckoutModule } from "../checkout/checkout.module.ts";
import { MailModule } from "../mail/mail.module.ts";
import { OrderEmails } from "./order-emails.ts";
import { OrdersController } from "./orders.controller.ts";
import { Orders } from "./orders.service.ts";

/** Orders: placed from the cart, holding stock and coupon until paid (stage 6) or expired. */
@Module({
  imports: [CartsModule, CatalogModule, CheckoutModule, MailModule],
  controllers: [OrdersController],
  providers: [Orders, OrderEmails],
  exports: [Orders],
})
export class OrdersModule {}
