-- Order numbers start at 1001 as the sequence's own start, not only its current value: a restart (a
-- TRUNCATE … RESTART IDENTITY, say) goes back to #1001, never to #1.
ALTER SEQUENCE "orders_number_seq" START WITH 1001;
