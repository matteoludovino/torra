import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.ts";
import { Catalog } from "./catalog.service.ts";
import { Stock } from "./stock.service.ts";

/** The storefront and the stock behind it. */
@Module({
  controllers: [CatalogController],
  providers: [Catalog, Stock],
  exports: [Catalog, Stock],
})
export class CatalogModule {}
