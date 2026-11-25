import { Controller, Get, Param, Query } from "@nestjs/common";
import { catalogFilters, type CatalogFilters, type ProductDetail, type ProductSummary } from "@torra/shared";
import { z } from "zod";
import { Public, Viewer, type AuthUser } from "../auth/auth-user.ts";
import { ZodPipe } from "../common/zod.pipe.ts";
import { Catalog } from "./catalog.service.ts";

const slug = new ZodPipe(z.string().regex(/^[a-z0-9-]{1,80}$/), { notFound: "Produto não encontrado." });

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalog: Catalog) {}

  @Public()
  @Get()
  list(
    @Viewer() viewer: AuthUser | null,
    @Query(new ZodPipe(catalogFilters)) filters: CatalogFilters,
  ): Promise<ProductSummary[]> {
    return this.catalog.list(viewer, filters);
  }

  @Public()
  @Get(":slug")
  detail(@Viewer() viewer: AuthUser | null, @Param("slug", slug) value: string): Promise<ProductDetail> {
    return this.catalog.detail(viewer, value);
  }
}
