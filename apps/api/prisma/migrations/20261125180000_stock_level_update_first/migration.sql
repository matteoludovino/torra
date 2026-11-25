-- Each movement updates its level, creating the level on its first movement. Update first, insert only
-- when there's no level yet: INSERT … ON CONFLICT DO UPDATE checks the CHECK constraints against the row it
-- would insert (here, the bare movement: a reservation of 3 is "available = -3") before resolving the
-- conflict, so it refused every reservation. A first movement that is negative still fails, as it must:
-- there's nothing to take from.
CREATE OR REPLACE FUNCTION stock_movements_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_levels SET available = available + NEW.quantity, "updatedAt" = NEW."createdAt"
  WHERE "variantId" = NEW."variantId" AND "sandboxId" IS NOT DISTINCT FROM NEW."sandboxId";
  IF NOT FOUND THEN
    INSERT INTO stock_levels (id, "variantId", "sandboxId", available, "updatedAt")
    VALUES (gen_random_uuid(), NEW."variantId", NEW."sandboxId", NEW.quantity, NEW."createdAt");
  END IF;
  RETURN NEW;
END $$;
