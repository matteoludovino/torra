-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'requires_action', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "RefundOrigin" AS ENUM ('panel', 'cancellation', 'stripe');

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "stripeRefundId" VARCHAR(80),
    "amountCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "status" "RefundStatus" NOT NULL,
    "origin" "RefundOrigin" NOT NULL,
    "reason" VARCHAR(200),
    "failureReason" VARCHAR(200),
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_items" (
    "id" UUID NOT NULL,
    "refundId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "restock" INTEGER NOT NULL DEFAULT 0,
    "restocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_stripeRefundId_key" ON "refunds"("stripeRefundId");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE INDEX "refunds_status_updatedAt_idx" ON "refunds"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "refund_items_refundId_orderItemId_key" ON "refund_items"("refundId", "orderItemId");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Refunds: positive amounts, shipping within the amount, lines within the units bought.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amountCents" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shipping_within" CHECK ("shippingCents" BETWEEN 0 AND "amountCents");
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_quantity" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_amount" CHECK ("amountCents" >= 0);
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_restock" CHECK ("restock" BETWEEN 0 AND "quantity");

-- What counts against the payment: refunds pending (Stripe has them, or is about to), needing action, or
-- done. The order's total of them is kept here, one change at a time (safe under concurrent refunds: each
-- applies to the latest row), and the order's CHECK refuses anything beyond what was paid.
CREATE FUNCTION refund_counts(status "RefundStatus") RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT status IN ('pending', 'requires_action', 'succeeded')
$$;

CREATE FUNCTION refunds_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delta int := 0;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND refund_counts(NEW.status) THEN delta := delta + NEW."amountCents"; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND refund_counts(OLD.status) THEN delta := delta - OLD."amountCents"; END IF;
  IF delta <> 0 THEN
    UPDATE orders SET "amountRefundedCents" = "amountRefundedCents" + delta
    WHERE id = COALESCE(NEW."orderId", OLD."orderId");
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "refunds_total" AFTER INSERT OR UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_total();

-- A refund's money and lines never change; its status only moves forward (a refund Stripe accepted can
-- still fail later; failed and canceled are final).
CREATE FUNCTION refunds_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."orderId", NEW."amountCents", NEW."shippingCents", NEW.origin, NEW."createdAt")
     IS DISTINCT FROM (OLD."orderId", OLD."amountCents", OLD."shippingCents", OLD.origin, OLD."createdAt") THEN
    RAISE EXCEPTION 'a refund''s amount never changes' USING ERRCODE = '42501';
  END IF;
  IF OLD."stripeRefundId" IS NOT NULL AND NEW."stripeRefundId" IS DISTINCT FROM OLD."stripeRefundId" THEN
    RAISE EXCEPTION 'a refund''s Stripe id never changes' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('requires_action', 'succeeded', 'failed', 'canceled'))
    OR (OLD.status = 'requires_action' AND NEW.status IN ('pending', 'succeeded', 'failed', 'canceled'))
    OR (OLD.status = 'succeeded' AND NEW.status IN ('failed', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'a refund cannot go from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "refunds_frozen" BEFORE UPDATE ON "refunds" FOR EACH ROW EXECUTE FUNCTION refunds_frozen();

CREATE FUNCTION refund_items_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."refundId", NEW."orderItemId", NEW.quantity, NEW."amountCents", NEW.restock)
     IS DISTINCT FROM (OLD."refundId", OLD."orderItemId", OLD.quantity, OLD."amountCents", OLD.restock)
     OR (OLD.restocked AND NOT NEW.restocked) THEN
    RAISE EXCEPTION 'refund lines never change (only their restock is marked done)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "refund_items_frozen" BEFORE UPDATE ON "refund_items"
  FOR EACH ROW EXECUTE FUNCTION refund_items_frozen();

-- At commit: a refund's lines add up to it (with its shipping) and belong to its order; across the
-- order's refunds that count, no line gives back more units or money than it was bought for, and shipping
-- comes back at most once. Restocking is for shipped goods only.
CREATE FUNCTION refunds_check(order_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  bad record;
BEGIN
  SELECT r.id INTO bad FROM refunds r
  WHERE r."orderId" = order_id AND EXISTS (SELECT 1 FROM refund_items x WHERE x."refundId" = r.id)
    AND r."amountCents" <> r."shippingCents" + (SELECT sum(x."amountCents") FROM refund_items x WHERE x."refundId" = r.id);
  IF FOUND THEN RAISE EXCEPTION 'refund % does not add up', bad.id USING ERRCODE = '23514'; END IF;

  SELECT x.id INTO bad FROM refund_items x JOIN refunds r ON r.id = x."refundId"
    JOIN order_items i ON i.id = x."orderItemId"
  WHERE r."orderId" = order_id AND (i."orderId" <> r."orderId" OR (x.restock > 0 AND i.kind <> 'physical'));
  IF FOUND THEN RAISE EXCEPTION 'a refund line belongs to its order, and only goods are restocked' USING ERRCODE = '23514'; END IF;

  SELECT i.id INTO bad FROM order_items i
    JOIN refund_items x ON x."orderItemId" = i.id JOIN refunds r ON r.id = x."refundId"
  WHERE i."orderId" = order_id AND refund_counts(r.status)
  GROUP BY i.id, i.quantity, i."lineTotalCents", i."discountCents"
  HAVING sum(x.quantity) > i.quantity OR sum(x."amountCents") > i."lineTotalCents" - i."discountCents";
  IF FOUND THEN RAISE EXCEPTION 'more refunded than bought on an order line' USING ERRCODE = '23514'; END IF;

  IF (SELECT COALESCE(sum("shippingCents"), 0) FROM refunds WHERE "orderId" = order_id AND refund_counts(status))
     > (SELECT "shippingCents" FROM orders WHERE id = order_id) THEN
    RAISE EXCEPTION 'more shipping refunded than was paid' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION refunds_check_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'refunds' THEN
    PERFORM refunds_check(NEW."orderId");
  ELSE
    PERFORM refunds_check((SELECT "orderId" FROM refunds WHERE id = NEW."refundId"));
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "refunds_add_up" AFTER INSERT OR UPDATE ON "refunds"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refunds_check_row();
CREATE CONSTRAINT TRIGGER "refund_items_add_up" AFTER INSERT ON "refund_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refunds_check_row();

-- Reservations and releases happen once per order and variant; restocks may happen once per refund.
DROP INDEX "stock_movements_orderId_variantId_kind_key";
CREATE UNIQUE INDEX "stock_movements_orderId_variantId_kind_key" ON "stock_movements"("orderId", "variantId", "kind")
  WHERE "kind" IN ('reserve', 'release');
