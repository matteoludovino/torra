import { Module } from "@nestjs/common";
import { CartsModule } from "../cart/carts.module.ts";
import { AddressLookup } from "./address-lookup.ts";
import { CheckoutController } from "./checkout.controller.ts";
import { Coupons } from "./coupons.service.ts";
import { Quotes } from "./quotes.service.ts";

/** Pricing a cart: coupons, shipping, totals (and, from stage 5, placing the order). */
@Module({
  imports: [CartsModule],
  controllers: [CheckoutController],
  providers: [AddressLookup, Coupons, Quotes],
  exports: [AddressLookup, Coupons, Quotes],
})
export class CheckoutModule {}
