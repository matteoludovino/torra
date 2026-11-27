-- A stock correction says why (the admin panel asks; the audit log names who).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjust_reason"
  CHECK ("kind" <> 'adjust' OR length(btrim(coalesce("reason", ''))) > 0);

-- Fulfillment is for orders with something to ship: a digital-only order stays "paid" (its downloads
-- are its delivery).
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfilled_ships"
  CHECK (("status" IN ('preparing', 'shipped', 'delivered')) <= ("cep" IS NOT NULL));
