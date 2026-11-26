import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { placeOrderInput, type OrderSummary, type OrderView } from "@torra/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../auth/auth-user.ts";
import { uuidParam } from "../common/params.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { Orders } from "./orders.service.ts";

const orderId = uuidParam("Pedido não encontrado.");

/** A customer's orders: placing one from the cart, following it, giving up on it before paying. */
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: Orders) {}

  @Post()
  @HttpCode(201)
  place(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(placeOrderInput)) body: z.infer<typeof placeOrderInput>,
  ): Promise<OrderView> {
    return this.orders.place(user, body);
  }

  @Get()
  mine(@CurrentUser() user: AuthUser): Promise<OrderSummary[]> {
    return this.orders.mine(user);
  }

  @Get(":id")
  view(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<OrderView> {
    return this.orders.view(user, id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<OrderView> {
    return this.orders.cancel(user, id);
  }
}
