-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN     "paymentProblem" VARCHAR(200);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "objectId" VARCHAR(255) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downloads" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "downloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "downloads_orderItemId_idx" ON "downloads"("orderItemId");

-- CreateIndex
CREATE INDEX "orders_status_paymentCheckedAt_idx" ON "orders"("status", "paymentCheckedAt");

-- AddForeignKey
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Money: a paid order (one that cost something) was paid through its PaymentIntent, one that matched it.
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_attempt" CHECK ("paymentAttempt" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_through_stripe" CHECK (
  ("status" IN ('paid', 'preparing', 'shipped', 'delivered') AND "totalCents" > 0)
    <= ("paymentIntentId" IS NOT NULL AND "paymentProblem" IS NULL)
);

-- Which PaymentIntent pays an order changes only while it waits for payment, and attempts only go up.
CREATE FUNCTION orders_payment_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending_payment' AND NEW."paymentIntentId" IS DISTINCT FROM OLD."paymentIntentId" THEN
    RAISE EXCEPTION 'order % is no longer waiting for payment: its PaymentIntent stays', OLD.number
      USING ERRCODE = '42501';
  END IF;
  IF NEW."paymentAttempt" < OLD."paymentAttempt" THEN
    RAISE EXCEPTION 'order %: payment attempts only go up', OLD.number USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_payment_frozen" BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_payment_frozen();

-- A download is of a digital item of a paid order.
CREATE FUNCTION downloads_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i."orderId"
    WHERE i.id = NEW."orderItemId" AND i.kind = 'digital'
      AND o.status IN ('paid', 'preparing', 'shipped', 'delivered')
  ) THEN
    RAISE EXCEPTION 'only a paid order''s digital items are downloaded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "downloads_check" BEFORE INSERT ON "downloads" FOR EACH ROW EXECUTE FUNCTION downloads_check();
