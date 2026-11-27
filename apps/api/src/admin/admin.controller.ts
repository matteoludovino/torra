import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  adminCustomersQuery,
  adminOrdersQuery,
  couponInput,
  couponUpdate,
  productInput,
  productUpdate,
  shipOrderInput,
  stockAdjustment,
  variantInput,
  variantUpdate,
  type AdminCoupon,
  type AdminCustomer,
  type AdminDashboard,
  type AdminOrderPage,
  type AdminOrderView,
  type AdminProduct,
  type AuditEntryView,
} from "@torra/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../auth/auth-user.ts";
import { uuidParam } from "../common/params.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { AdminCatalog } from "./admin-catalog.service.ts";
import { AdminCoupons } from "./admin-coupons.service.ts";
import { AdminInsights } from "./admin-insights.service.ts";
import { AdminOrders } from "./admin-orders.service.ts";
import { asAdmin } from "./scope.ts";

const orderId = uuidParam("Pedido não encontrado.");
const productId = uuidParam("Produto não encontrado.");
const variantId = uuidParam("Variante não encontrada.");
const couponId = uuidParam("Cupom não encontrado.");

/** The admin panel's API: admins only (403 otherwise), each within their own scope (see `asAdmin`). */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly orders: AdminOrders,
    private readonly catalog: AdminCatalog,
    private readonly coupons: AdminCoupons,
    private readonly insights: AdminInsights,
  ) {}

  @Get("dashboard")
  dashboard(@CurrentUser() user: AuthUser): Promise<AdminDashboard> {
    return this.insights.dashboard(asAdmin(user));
  }

  @Post("events/:id/retry")
  @HttpCode(204)
  retry(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<void> {
    return this.insights.retry(asAdmin(user), id);
  }

  @Get("orders")
  listOrders(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(adminOrdersQuery)) query: z.infer<typeof adminOrdersQuery>,
  ): Promise<AdminOrderPage> {
    return this.orders.list(asAdmin(user), query);
  }

  @Get("orders/:id")
  order(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<AdminOrderView> {
    return this.orders.view(asAdmin(user), id);
  }

  @Post("orders/:id/prepare")
  @HttpCode(200)
  prepare(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<AdminOrderView> {
    return this.orders.prepare(asAdmin(user), id);
  }

  @Post("orders/:id/ship")
  @HttpCode(200)
  ship(
    @CurrentUser() user: AuthUser,
    @Param("id", orderId) id: string,
    @Body(new ZodPipe(shipOrderInput)) body: z.infer<typeof shipOrderInput>,
  ): Promise<AdminOrderView> {
    return this.orders.ship(asAdmin(user), id, body.trackingCode);
  }

  @Post("orders/:id/deliver")
  @HttpCode(200)
  deliver(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<AdminOrderView> {
    return this.orders.deliver(asAdmin(user), id);
  }

  @Post("orders/:id/cancel")
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<AdminOrderView> {
    return this.orders.cancel(asAdmin(user), id);
  }

  @Post("orders/:id/reconcile")
  @HttpCode(200)
  reconcile(@CurrentUser() user: AuthUser, @Param("id", orderId) id: string): Promise<AdminOrderView> {
    return this.orders.reconcile(asAdmin(user), id);
  }

  @Get("products")
  products(@CurrentUser() user: AuthUser): Promise<AdminProduct[]> {
    return this.catalog.list(asAdmin(user));
  }

  @Post("products")
  createProduct(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(productInput)) body: z.infer<typeof productInput>,
  ): Promise<AdminProduct> {
    return this.catalog.create(asAdmin(user), body);
  }

  @Patch("products/:id")
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param("id", productId) id: string,
    @Body(new ZodPipe(productUpdate)) body: z.infer<typeof productUpdate>,
  ): Promise<AdminProduct> {
    return this.catalog.update(asAdmin(user), id, body);
  }

  @Post("products/:id/variants")
  addVariant(
    @CurrentUser() user: AuthUser,
    @Param("id", productId) id: string,
    @Body(new ZodPipe(variantInput)) body: z.infer<typeof variantInput>,
  ): Promise<AdminProduct> {
    return this.catalog.addVariant(asAdmin(user), id, body);
  }

  @Patch("variants/:id")
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param("id", variantId) id: string,
    @Body(new ZodPipe(variantUpdate)) body: z.infer<typeof variantUpdate>,
  ): Promise<AdminProduct> {
    return this.catalog.updateVariant(asAdmin(user), id, body);
  }

  @Post("variants/:id/stock")
  @HttpCode(200)
  adjustStock(
    @CurrentUser() user: AuthUser,
    @Param("id", variantId) id: string,
    @Body(new ZodPipe(stockAdjustment)) body: z.infer<typeof stockAdjustment>,
  ): Promise<AdminProduct> {
    return this.catalog.adjustStock(asAdmin(user), id, body);
  }

  @Get("coupons")
  listCoupons(@CurrentUser() user: AuthUser): Promise<AdminCoupon[]> {
    return this.coupons.list(asAdmin(user));
  }

  @Post("coupons")
  createCoupon(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(couponInput)) body: z.infer<typeof couponInput>,
  ): Promise<AdminCoupon> {
    return this.coupons.create(asAdmin(user), body);
  }

  @Patch("coupons/:id")
  updateCoupon(
    @CurrentUser() user: AuthUser,
    @Param("id", couponId) id: string,
    @Body(new ZodPipe(couponUpdate)) body: z.infer<typeof couponUpdate>,
  ): Promise<AdminCoupon> {
    return this.coupons.setActive(asAdmin(user), id, body.active);
  }

  @Get("customers")
  customers(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(adminCustomersQuery)) query: z.infer<typeof adminCustomersQuery>,
  ): Promise<AdminCustomer[]> {
    return this.insights.customers(asAdmin(user), query.q);
  }

  @Get("audit")
  audit(@CurrentUser() user: AuthUser): Promise<AuditEntryView[]> {
    return this.insights.recentAudit(asAdmin(user));
  }
}
