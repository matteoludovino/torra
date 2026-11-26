import { ConflictException, Injectable } from "@nestjs/common";
import {
  chargeable,
  computeTotals,
  quoteShipping,
  type Address,
  type CartView,
  type Quote,
  type QuoteInput,
} from "@torra/shared";
import type { FastifyRequest } from "fastify";
import type { AuthUser } from "../auth/auth-user.ts";
import { Carts } from "../cart/carts.service.ts";
import { RateLimiter } from "../common/rate-limiter.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { Clock } from "../time/clock.ts";
import { AddressLookup } from "./address-lookup.ts";
import { Coupons } from "./coupons.service.ts";

type Parsed<T> = { [K in keyof T]: Exclude<T[K], undefined> | undefined };

/** CEP lookups per address and minute (they reach an outside service). */
const LOOKUPS = { max: 30, windowMs: 60_000 };

/**
 * Prices the current cart: coupon, shipping to a CEP, and the totals, always computed here from the
 * catalog's prices. Placing an order (stage 5) prices it the same way, inside its transaction.
 */
@Injectable()
export class Quotes {
  constructor(
    private readonly db: PrismaService,
    private readonly clock: Clock,
    private readonly carts: Carts,
    private readonly coupons: Coupons,
    private readonly addresses: AddressLookup,
    private readonly limiter: RateLimiter,
  ) {}

  async quote(viewer: AuthUser | null, request: FastifyRequest, input: Parsed<QuoteInput>): Promise<Quote> {
    const cart = await this.carts.view(viewer, request);
    if (cart.lines.length === 0) {
      throw new ConflictException({ code: "empty_cart", message: "Seu carrinho está vazio." });
    }
    const user = { userId: viewer?.sandboxId ? viewer.id : null, sandboxId: viewer?.sandboxId ?? null };

    let coupon: Quote["coupon"] = null;
    let couponProblem: string | null = null;
    let discount = null;
    if (input.couponCode) {
      const check = await this.coupons.check(
        this.db,
        input.couponCode,
        user,
        cart.subtotalCents,
        this.clock.now(),
      );
      if (check.ok) {
        coupon = { code: check.coupon.code, description: check.description };
        discount = check.discount;
      } else couponProblem = check.problem;
    }
    const products = computeTotals({ lines: lineKeys(cart), discount, shippingCents: 0 });

    const digitalOnly = cart.lines.every((line) => line.product.kind === "digital");
    let address: Address | null = null;
    let shippingProblem: Quote["shippingProblem"] = null;
    if (!digitalOnly) {
      if (!input.cep) shippingProblem = "needs_cep";
      else {
        this.limiter.hit(`cep:ip:${request.ip}`, LOOKUPS);
        const found = await this.addresses.lookup(input.cep);
        if ("unavailable" in found) {
          if (input.uf) address = { cep: input.cep, street: "", district: "", city: "", uf: input.uf };
          else shippingProblem = "lookup_unavailable";
        } else if (!found.found) shippingProblem = "unknown_cep";
        else address = found.address;
      }
    }
    const weight = cart.lines.reduce((sum, line) => sum + (line.weightGrams ?? 0) * line.quantity, 0);
    const shippingOptions = address
      ? quoteShipping(address.uf, weight, products.subtotalCents - products.discountCents)
      : [];
    const chosen = shippingOptions.find(
      (option) => option.service === (input.shippingService ?? "economico"),
    );
    const totals = computeTotals({ lines: lineKeys(cart), discount, shippingCents: chosen?.priceCents ?? 0 });

    return {
      digitalOnly,
      address,
      shippingProblem,
      shippingOptions,
      shippingService: chosen?.service ?? null,
      coupon,
      couponProblem,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      shippingCents: totals.shippingCents,
      totalCents: totals.totalCents,
      belowMinimum: !chargeable(totals.totalCents),
      complete: cart.ready && (digitalOnly || chosen !== undefined) && chargeable(totals.totalCents),
    };
  }
}

function lineKeys(cart: CartView) {
  return cart.lines.map((line) => ({
    key: line.variantId,
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
  }));
}
