-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('physical', 'digital');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('seed', 'copy', 'adjust', 'reserve', 'release', 'restock');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sandboxId" UUID,
    "slug" VARCHAR(80) NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "subtitle" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "art" VARCHAR(40) NOT NULL,
    "optionNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sandboxId" UUID,
    "sku" VARCHAR(40) NOT NULL,
    "optionValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priceCents" INTEGER NOT NULL,
    "compareAtCents" INTEGER,
    "weightGrams" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "sandboxId" UUID,
    "available" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "sandboxId" UUID,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "orderId" UUID,
    "reason" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_category_position_idx" ON "products"("category", "position");

-- CreateIndex
-- NULLS NOT DISTINCT (here and for SKUs and stock levels): "no sandbox" is one corner of the store, so the
-- shared catalog can't have two products with one slug, nor a variant two shared stock levels.
CREATE UNIQUE INDEX "products_slug_sandboxId_key" ON "products"("slug", "sandboxId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "variants_productId_position_idx" ON "variants"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "variants_sku_sandboxId_key" ON "variants"("sku", "sandboxId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_variantId_sandboxId_key" ON "stock_levels"("variantId", "sandboxId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "stock_movements_variantId_sandboxId_idx" ON "stock_movements"("variantId", "sandboxId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_orderId_variantId_kind_key" ON "stock_movements"("orderId", "variantId", "kind");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Rules the database keeps, whatever the code does.

ALTER TABLE "variants" ADD CONSTRAINT "variants_price_positive" CHECK ("priceCents" > 0);
ALTER TABLE "variants" ADD CONSTRAINT "variants_compare_at_above_price"
  CHECK ("compareAtCents" IS NULL OR "compareAtCents" > "priceCents");
ALTER TABLE "variants" ADD CONSTRAINT "variants_weight_positive" CHECK ("weightGrams" IS NULL OR "weightGrams" > 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_available_nonnegative" CHECK ("available" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign" CHECK (
  CASE "kind"
    WHEN 'seed' THEN "quantity" > 0
    WHEN 'copy' THEN "quantity" > 0
    WHEN 'reserve' THEN "quantity" < 0
    WHEN 'release' THEN "quantity" > 0
    WHEN 'restock' THEN "quantity" > 0
    ELSE TRUE
  END
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_kinds"
  CHECK (("kind" IN ('reserve', 'release', 'restock')) = ("orderId" IS NOT NULL));

-- A variant belongs to its product's corner of the store, has one value per option, and is weighed if
-- (and only if) it is shipped.
CREATE FUNCTION variants_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  product products%ROWTYPE;
BEGIN
  SELECT * INTO product FROM products WHERE id = NEW."productId";
  IF NEW."sandboxId" IS DISTINCT FROM product."sandboxId" THEN
    RAISE EXCEPTION 'a variant lives in its product''s sandbox' USING ERRCODE = '23514';
  END IF;
  IF cardinality(NEW."optionValues") <> cardinality(product."optionNames") THEN
    RAISE EXCEPTION 'a variant needs one value per option of its product' USING ERRCODE = '23514';
  END IF;
  IF (product.kind = 'physical') <> (NEW."weightGrams" IS NOT NULL) THEN
    RAISE EXCEPTION 'physical variants (only) have a weight' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "variants_consistent" BEFORE INSERT OR UPDATE ON "variants"
  FOR EACH ROW EXECUTE FUNCTION variants_consistent();

-- Stock movements: physical variants only; a sandbox moves stock of shared variants or of its own, never
-- another sandbox's; the shared catalog's stock is moved only with no sandbox.
CREATE FUNCTION stock_movements_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  variant_sandbox uuid;
  product_kind "ProductKind";
BEGIN
  SELECT v."sandboxId", p.kind INTO variant_sandbox, product_kind
  FROM variants v JOIN products p ON p.id = v."productId" WHERE v.id = NEW."variantId";
  IF product_kind <> 'physical' THEN
    RAISE EXCEPTION 'digital products have no stock' USING ERRCODE = '23514';
  END IF;
  IF variant_sandbox IS NOT NULL AND NEW."sandboxId" IS DISTINCT FROM variant_sandbox THEN
    RAISE EXCEPTION 'stock of a sandbox''s own product moves only in that sandbox' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'copy' AND (NEW."sandboxId" IS NULL OR variant_sandbox IS NOT NULL) THEN
    RAISE EXCEPTION 'only a sandbox copies, and only shared stock' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_movements_check" BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_check();

-- Each movement updates its level (creating it on the first one). The CHECK above makes a movement that
-- would take a level below zero fail, rolling back the whole transaction.
CREATE FUNCTION stock_movements_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO stock_levels (id, "variantId", "sandboxId", available, "updatedAt")
  VALUES (gen_random_uuid(), NEW."variantId", NEW."sandboxId", NEW.quantity, NEW."createdAt")
  ON CONFLICT ("variantId", "sandboxId") DO UPDATE
    SET available = stock_levels.available + EXCLUDED.available, "updatedAt" = EXCLUDED."updatedAt";
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_movements_apply" AFTER INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_apply();

-- Levels are written only by that trigger: a level is always the sum of its movements.
CREATE FUNCTION stock_levels_derived() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'stock levels change only through stock movements' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_levels_derived" BEFORE INSERT OR UPDATE ON "stock_levels"
  FOR EACH ROW EXECUTE FUNCTION stock_levels_derived();

-- Movements are append-only; removing a whole sandbox (and resetting tests) purges under torra.purge.
CREATE FUNCTION stock_movements_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('torra.purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
  END IF;
  RAISE EXCEPTION 'stock movements are append-only (% on %)', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION stock_movements_append_only();

-- ---------------------------------------------------------------------------------------------------------
-- Portuguese search that ignores accents ("cafe" finds "café"): the unaccent dictionary inside a text
-- search configuration can feed a generated column (to_tsvector(regconfig, text) is IMMUTABLE; the
-- unaccent() function isn't). Weighted: title (A), subtitle (B), description (C).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION pt_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;

ALTER TABLE "products" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('pt_unaccent', "title"), 'A') ||
  setweight(to_tsvector('pt_unaccent', "subtitle"), 'B') ||
  setweight(to_tsvector('pt_unaccent', "description"), 'C')
) STORED;
CREATE INDEX "products_search_idx" ON "products" USING GIN ("search");
