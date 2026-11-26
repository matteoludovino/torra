-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "tokenHash" BYTEA,
    "sandboxId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "seenPriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("cartId","variantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_userId_key" ON "carts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_tokenHash_key" ON "carts"("tokenHash");

-- CreateIndex
CREATE INDEX "carts_updatedAt_idx" ON "carts"("updatedAt");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A cart belongs to an account or to a visitor's cookie, never both, never neither.
ALTER TABLE "carts" ADD CONSTRAINT "carts_one_owner" CHECK (("userId" IS NULL) <> ("tokenHash" IS NULL));
-- A visitor (no account) shops the shared catalog only.
ALTER TABLE "carts" ADD CONSTRAINT "carts_visitors_outside_sandboxes"
  CHECK ("userId" IS NOT NULL OR "sandboxId" IS NULL);
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_seen_price_positive" CHECK ("seenPriceCents" > 0);

-- An item is a variant the cart's owner can see: the shared catalog's, or their own sandbox's.
CREATE FUNCTION cart_items_visible() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cart_sandbox uuid;
  variant_sandbox uuid;
BEGIN
  SELECT "sandboxId" INTO cart_sandbox FROM carts WHERE id = NEW."cartId";
  SELECT "sandboxId" INTO variant_sandbox FROM variants WHERE id = NEW."variantId";
  IF variant_sandbox IS NOT NULL AND variant_sandbox IS DISTINCT FROM cart_sandbox THEN
    RAISE EXCEPTION 'a cart holds shared variants or its own sandbox''s only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cart_items_visible" BEFORE INSERT OR UPDATE ON "cart_items"
  FOR EACH ROW EXECUTE FUNCTION cart_items_visible();
