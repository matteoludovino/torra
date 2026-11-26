-- CreateEnum
CREATE TYPE "CouponKind" AS ENUM ('percent', 'fixed');

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "sandboxId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "kind" "CouponKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "maxRedemptions" INTEGER,
    "oncePerCustomer" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sandboxId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "exclusive" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- "No sandbox" is one corner of the store: two shared coupons never share a code.
CREATE UNIQUE INDEX "coupons_code_sandboxId_key" ON "coupons"("code", "sandboxId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_sandboxId_idx" ON "coupon_redemptions"("couponId", "sandboxId");

-- CreateIndex
-- One live use per customer of a coupon that says "once per customer" (a released use frees it again).
CREATE UNIQUE INDEX "coupon_redemptions_couponId_userId_key" ON "coupon_redemptions"("couponId", "userId")
  WHERE "exclusive" AND "releasedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_code_format" CHECK ("code" ~ '^[A-Z0-9_-]{3,30}$');
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_range"
  CHECK (("kind" = 'percent' AND "value" BETWEEN 1 AND 100) OR ("kind" = 'fixed' AND "value" > 0));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_min_subtotal_nonnegative" CHECK ("minSubtotalCents" >= 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_window" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_max_positive" CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" > 0);

-- A sandbox's code never shadows a shared one, nor a shared one a code some sandbox already has: one code,
-- one coupon, whoever looks.
CREATE FUNCTION coupons_no_shadowing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM coupons c
    WHERE c.code = NEW.code AND c.id <> NEW.id
      AND (c."sandboxId" IS NULL OR NEW."sandboxId" IS NULL)
  ) THEN
    RAISE EXCEPTION 'coupon code % is taken', NEW.code USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "coupons_no_shadowing" BEFORE INSERT OR UPDATE OF code, "sandboxId" ON "coupons"
  FOR EACH ROW EXECUTE FUNCTION coupons_no_shadowing();

-- A use is counted in the customer's own corner, of a coupon they can see.
CREATE FUNCTION coupon_redemptions_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  coupon_sandbox uuid;
  user_sandbox uuid;
BEGIN
  SELECT "sandboxId" INTO coupon_sandbox FROM coupons WHERE id = NEW."couponId";
  SELECT "sandboxId" INTO user_sandbox FROM users WHERE id = NEW."userId";
  IF NEW."sandboxId" IS DISTINCT FROM user_sandbox THEN
    RAISE EXCEPTION 'a coupon use belongs to the customer''s sandbox' USING ERRCODE = '23514';
  END IF;
  IF coupon_sandbox IS NOT NULL AND coupon_sandbox IS DISTINCT FROM user_sandbox THEN
    RAISE EXCEPTION 'a customer uses shared coupons or their own sandbox''s' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "coupon_redemptions_consistent" BEFORE INSERT ON "coupon_redemptions"
  FOR EACH ROW EXECUTE FUNCTION coupon_redemptions_consistent();
