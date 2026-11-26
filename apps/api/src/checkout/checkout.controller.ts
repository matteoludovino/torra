import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  NotFoundException,
} from "@nestjs/common";
import { cep, quoteInput, type Address, type Quote } from "@torra/shared";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { Public, Viewer, type AuthUser } from "../auth/auth-user.ts";
import { RateLimiter } from "../common/rate-limiter.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { AddressLookup } from "./address-lookup.ts";
import { Quotes } from "./quotes.service.ts";

const cepParam = new ZodPipe(cep, { notFound: "CEP não encontrado." });

@Controller()
export class CheckoutController {
  constructor(
    private readonly quotes: Quotes,
    private readonly addresses: AddressLookup,
    private readonly limiter: RateLimiter,
  ) {}

  /** Prices the current cart: coupon, shipping to a CEP, totals. */
  @Public()
  @Post("checkout/quote")
  @HttpCode(200)
  quote(
    @Viewer() viewer: AuthUser | null,
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(quoteInput)) body: z.infer<typeof quoteInput>,
  ): Promise<Quote> {
    return this.quotes.quote(viewer, request, body);
  }

  /** A CEP's address, to fill in the checkout form. */
  @Public()
  @Get("address/:cep")
  async address(@Req() request: FastifyRequest, @Param("cep", cepParam) value: string): Promise<Address> {
    this.limiter.hit(`cep:ip:${request.ip}`, { max: 30, windowMs: 60_000 });
    const found = await this.addresses.lookup(value);
    if ("unavailable" in found) {
      throw new ServiceUnavailableException({
        code: "lookup_unavailable",
        message: "A busca de CEP não respondeu. Preencha o endereço à mão.",
        retryAfter: 30,
      });
    }
    if (!found.found) throw new NotFoundException({ code: "not_found", message: "CEP não encontrado." });
    return found.address;
  }
}
