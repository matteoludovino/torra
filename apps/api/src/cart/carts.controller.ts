import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from "@nestjs/common";
import { addToCartInput, setQuantityInput, type CartView } from "@torra/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { Public, Viewer, type AuthUser } from "../auth/auth-user.ts";
import { uuidParam } from "../common/params.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { Carts } from "./carts.service.ts";

const variantId = uuidParam("Este item não está no carrinho.");

/** The cart: a visitor's (by cookie) or the signed-in customer's. */
@Controller("cart")
export class CartsController {
  constructor(private readonly carts: Carts) {}

  @Public()
  @Get()
  view(@Viewer() viewer: AuthUser | null, @Req() request: FastifyRequest): Promise<CartView> {
    return this.carts.view(viewer, request);
  }

  @Public()
  @Post("items")
  @HttpCode(200)
  add(
    @Viewer() viewer: AuthUser | null,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodPipe(addToCartInput)) body: z.infer<typeof addToCartInput>,
  ): Promise<CartView> {
    return this.carts.add(viewer, request, reply, body.variantId, body.quantity);
  }

  @Public()
  @Put("items/:variantId")
  setQuantity(
    @Viewer() viewer: AuthUser | null,
    @Req() request: FastifyRequest,
    @Param("variantId", variantId) id: string,
    @Body(new ZodPipe(setQuantityInput)) body: z.infer<typeof setQuantityInput>,
  ): Promise<CartView> {
    return this.carts.setQuantity(viewer, request, id, body.quantity);
  }

  @Public()
  @Delete("items/:variantId")
  remove(
    @Viewer() viewer: AuthUser | null,
    @Req() request: FastifyRequest,
    @Param("variantId", variantId) id: string,
  ): Promise<CartView> {
    return this.carts.setQuantity(viewer, request, id, 0);
  }

  @Public()
  @Post("acknowledge-prices")
  @HttpCode(200)
  acknowledge(@Viewer() viewer: AuthUser | null, @Req() request: FastifyRequest): Promise<CartView> {
    return this.carts.acknowledgePrices(viewer, request);
  }
}
