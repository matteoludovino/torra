import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.ts";
import { AccountsModule } from "../auth/accounts.module.ts";
import { OrdersModule } from "../orders/orders.module.ts";
import { PaymentsModule } from "../payments/payments.module.ts";
import { DemoController } from "./demo.controller.ts";
import { Demo } from "./demo.service.ts";

/** The one-click demo: a corner of the store of one's own, with a customer and its admin. */
@Module({
  imports: [AccountsModule, AdminModule, OrdersModule, PaymentsModule],
  controllers: [DemoController],
  providers: [Demo],
})
export class DemoModule {}
