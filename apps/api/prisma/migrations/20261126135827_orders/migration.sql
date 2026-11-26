-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'canceled', 'expired');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "sandboxId" UUID NOT NULL,
    "cartId" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "email" VARCHAR(254) NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "couponId" UUID,
    "couponCode" VARCHAR(30),
    "shippingService" VARCHAR(20),
    "shippingDaysMin" INTEGER,
    "shippingDaysMax" INTEGER,
    "recipient" VARCHAR(100),
    "cep" CHAR(8),
    "street" VARCHAR(120),
    "streetNumber" VARCHAR(20),
    "complement" VARCHAR(60),
    "district" VARCHAR(80),
    "city" VARCHAR(80),
    "uf" CHAR(2),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "paymentIntentId" VARCHAR(80),
    "latestChargeId" VARCHAR(80),
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "amountRefundedCents" INTEGER NOT NULL DEFAULT 0,
    "disputeStatus" VARCHAR(40),
    "paidAt" TIMESTAMPTZ(3),
    "trackingCode" VARCHAR(40),
    "shippedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "options" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "position" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "actorId" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paymentIntentId_key" ON "orders"("paymentIntentId");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_status_expiresAt_idx" ON "orders"("status", "expiresAt");

-- CreateIndex
-- One order waiting for payment per cart: a double click on "pay" places one order.
CREATE UNIQUE INDEX "orders_cartId_key" ON "orders"("cartId") WHERE "status" = 'pending_payment';

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_variantId_key" ON "order_items"("orderId", "variantId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Orders read as #1001, #1002…
ALTER SEQUENCE "orders_number_seq" RESTART WITH 1001;

-- ---------------------------------------------------------------------------------------------------------
-- Money and address, row by row.
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_nonnegative" CHECK (
  "subtotalCents" >= 0 AND "discountCents" >= 0 AND "shippingCents" >= 0
  AND "amountPaidCents" >= 0 AND "amountRefundedCents" >= 0
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total" CHECK ("totalCents" = "subtotalCents" - "discountCents" + "shippingCents");
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_within_subtotal" CHECK ("discountCents" <= "subtotalCents");
-- Stripe charges at least R$ 0,50; a free order is fine.
ALTER TABLE "orders" ADD CONSTRAINT "orders_chargeable" CHECK ("totalCents" = 0 OR "totalCents" >= 50);
ALTER TABLE "orders" ADD CONSTRAINT "orders_refund_within_paid" CHECK ("amountRefundedCents" <= "amountPaidCents");
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_whole" CHECK (
  ("cep" IS NULL) = ("recipient" IS NULL) AND ("cep" IS NULL) = ("street" IS NULL)
  AND ("cep" IS NULL) = ("streetNumber" IS NULL) AND ("cep" IS NULL) = ("district" IS NULL)
  AND ("cep" IS NULL) = ("city" IS NULL) AND ("cep" IS NULL) = ("uf" IS NULL)
  AND ("cep" IS NULL) = ("shippingService" IS NULL) AND ("cep" IS NULL) = ("shippingDaysMin" IS NULL)
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_cep_format" CHECK ("cep" ~ '^[0-9]{8}$');
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_whole" CHECK (("couponCode" IS NULL) OR ("discountCents" > 0 OR "subtotalCents" = 0));
-- Paid means paid in full (refunds are counted apart); shipped means a tracking code; closed means when.
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_states" CHECK (
  ("status" IN ('paid', 'preparing', 'shipped', 'delivered')) <= ("paidAt" IS NOT NULL AND "amountPaidCents" = "totalCents")
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipped_states" CHECK (
  ("status" IN ('shipped', 'delivered')) <= ("trackingCode" IS NOT NULL AND "shippedAt" IS NOT NULL)
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivered_state" CHECK (("status" = 'delivered') <= ("deliveredAt" IS NOT NULL));
ALTER TABLE "orders" ADD CONSTRAINT "orders_closed_states" CHECK (
  ("status" IN ('canceled', 'expired')) = ("closedAt" IS NOT NULL)
);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_positive" CHECK ("unitPriceCents" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_total" CHECK ("lineTotalCents" = "quantity" * "unitPriceCents");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_within_line"
  CHECK ("discountCents" >= 0 AND "discountCents" <= "lineTotalCents");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_weight_if_physical" CHECK (("kind" = 'physical') = ("weightGrams" IS NOT NULL));

-- ---------------------------------------------------------------------------------------------------------
-- An order and its lines agree, checked when the transaction commits (they're written in several
-- statements): the subtotal is the sum of the lines, the discount the sum of their shares, and there is
-- an address (and shipping) exactly when something is shipped.
CREATE FUNCTION orders_check(order_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  o orders%ROWTYPE;
  lines int;
  sum_total bigint;
  sum_discount bigint;
  physical boolean;
BEGIN
  SELECT * INTO o FROM orders WHERE id = order_id;
  IF NOT FOUND THEN RETURN; END IF; -- removed in the same transaction (a sandbox going away)
  SELECT count(*), COALESCE(sum("lineTotalCents"), 0), COALESCE(sum("discountCents"), 0), bool_or(kind = 'physical')
    INTO lines, sum_total, sum_discount, physical
  FROM order_items WHERE "orderId" = order_id;
  IF lines = 0 THEN
    RAISE EXCEPTION 'order % has no items', o.number USING ERRCODE = '23514';
  END IF;
  IF sum_total <> o."subtotalCents" OR sum_discount <> o."discountCents" THEN
    RAISE EXCEPTION 'order % does not add up (items % / %, order % / %)', o.number, sum_total, sum_discount,
      o."subtotalCents", o."discountCents" USING ERRCODE = '23514';
  END IF;
  IF physical <> (o.cep IS NOT NULL) THEN
    RAISE EXCEPTION 'order %: an address exactly when something ships', o.number USING ERRCODE = '23514';
  END IF;
  IF NOT physical AND o."shippingCents" <> 0 THEN
    RAISE EXCEPTION 'order %: no shipping without something to ship', o.number USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION orders_check_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM orders_check(CASE WHEN TG_TABLE_NAME = 'orders' THEN NEW.id ELSE NEW."orderId" END);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "orders_add_up" AFTER INSERT ON "orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_check_row();
CREATE CONSTRAINT TRIGGER "order_items_add_up" AFTER INSERT ON "order_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_check_row();

-- What was bought, for how much and where to, never changes; only its progress (status, payment,
-- shipping) does. Lines don't change at all.
CREATE FUNCTION orders_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."userId", NEW."sandboxId", NEW.email, NEW."subtotalCents", NEW."discountCents", NEW."shippingCents",
      NEW."totalCents", NEW."couponCode", NEW."shippingService", NEW."shippingDaysMin", NEW."shippingDaysMax",
      NEW.recipient, NEW.cep, NEW.street, NEW."streetNumber", NEW.complement, NEW.district, NEW.city, NEW.uf,
      NEW."createdAt", NEW.number)
     IS DISTINCT FROM
     (OLD."userId", OLD."sandboxId", OLD.email, OLD."subtotalCents", OLD."discountCents", OLD."shippingCents",
      OLD."totalCents", OLD."couponCode", OLD."shippingService", OLD."shippingDaysMin", OLD."shippingDaysMax",
      OLD.recipient, OLD.cep, OLD.street, OLD."streetNumber", OLD.complement, OLD.district, OLD.city, OLD.uf,
      OLD."createdAt", OLD.number) THEN
    RAISE EXCEPTION 'order % is frozen: what was bought and for how much never changes', OLD.number
      USING ERRCODE = '42501';
  END IF;
  -- Its progress only moves forward.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'pending_payment' AND NEW.status IN ('paid', 'canceled', 'expired'))
    OR (OLD.status = 'paid' AND NEW.status IN ('preparing', 'canceled'))
    OR (OLD.status = 'preparing' AND NEW.status IN ('shipped', 'canceled'))
    OR (OLD.status = 'shipped' AND NEW.status = 'delivered')
  ) THEN
    RAISE EXCEPTION 'order % cannot go from % to %', OLD.number, OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_frozen" BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION orders_frozen();

CREATE FUNCTION order_items_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order lines never change' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "order_items_frozen" BEFORE UPDATE ON "order_items" FOR EACH ROW EXECUTE FUNCTION order_items_frozen();

-- An order lives in its customer's sandbox, and its lines are things that customer can see.
CREATE FUNCTION orders_in_sandbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    IF NEW."sandboxId" IS DISTINCT FROM (SELECT "sandboxId" FROM users WHERE id = NEW."userId") THEN
      RAISE EXCEPTION 'an order lives in its customer''s sandbox' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (SELECT "sandboxId" FROM variants WHERE id = NEW."variantId") IS DISTINCT FROM NULL
       AND (SELECT "sandboxId" FROM variants WHERE id = NEW."variantId")
           IS DISTINCT FROM (SELECT "sandboxId" FROM orders WHERE id = NEW."orderId") THEN
      RAISE EXCEPTION 'an order holds shared variants or its own sandbox''s only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_in_sandbox" BEFORE INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION orders_in_sandbox();
CREATE TRIGGER "order_items_in_sandbox" BEFORE INSERT ON "order_items" FOR EACH ROW EXECUTE FUNCTION orders_in_sandbox();

-- Stock held or given back for an order moves in that order's sandbox.
CREATE OR REPLACE FUNCTION stock_movements_check() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW."orderId" IS NOT NULL
     AND NEW."sandboxId" IS DISTINCT FROM (SELECT "sandboxId" FROM orders WHERE id = NEW."orderId") THEN
    RAISE EXCEPTION 'an order''s stock moves in the order''s sandbox' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- The timeline is append-only (removing a whole sandbox purges it under torra.purge).
CREATE FUNCTION order_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('torra.purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
  END IF;
  RAISE EXCEPTION 'order events are append-only (% on %)', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "order_events_append_only" BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION order_events_append_only();
CREATE TRIGGER "order_events_no_truncate" BEFORE TRUNCATE ON "order_events"
  FOR EACH STATEMENT EXECUTE FUNCTION order_events_append_only();
