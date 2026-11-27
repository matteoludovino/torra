import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.ts";
import { OrdersModule } from "../orders/orders.module.ts";
import { PaymentsModule } from "../payments/payments.module.ts";
import { AdminCatalog } from "./admin-catalog.service.ts";
import { AdminCoupons } from "./admin-coupons.service.ts";
import { AdminInsights } from "./admin-insights.service.ts";
import { AdminOrders } from "./admin-orders.service.ts";
import { AdminController } from "./admin.controller.ts";

/** The admin panel: orders and fulfillment, catalog and stock, coupons, customers, the audit log. */
@Module({
  imports: [CatalogModule, OrdersModule, PaymentsModule],
  controllers: [AdminController],
  providers: [AdminOrders, AdminCatalog, AdminCoupons, AdminInsights],
  exports: [AdminOrders],
})
export class AdminModule {}
