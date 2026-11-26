-- The add-up trigger serves two tables: a CASE expression resolves both NEW.id and NEW."orderId" whichever
-- table fired it (and orders has no "orderId"), so each table gets its own statement.
CREATE OR REPLACE FUNCTION orders_check_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    PERFORM orders_check(NEW.id);
  ELSE
    PERFORM orders_check(NEW."orderId");
  END IF;
  RETURN NULL;
END $$;
