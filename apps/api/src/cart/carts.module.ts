import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.ts";
import { CartsController } from "./carts.controller.ts";
import { Carts } from "./carts.service.ts";

@Module({
  imports: [CatalogModule],
  controllers: [CartsController],
  providers: [Carts],
  exports: [Carts],
})
export class CartsModule {}
