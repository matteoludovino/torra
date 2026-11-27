# Architecture decisions

1. [One reconciliation decides payment state; webhooks only trigger it](0001-reconcile-with-stripe.md)
2. [A payment gateway port, with a deterministic fake](0002-gateway-port-and-fake.md)
3. [Stripe is never called inside a database transaction](0003-no-stripe-inside-transactions.md)
4. [Stock per sandbox, copy-on-write](0004-copy-on-write-stock.md)
5. [Money rules enforced by the database](0005-money-invariants-in-the-database.md)
6. [Refunds: the row first, and a lookup before any retry](0006-idempotent-refunds.md)
7. [Fulfillment status kept apart from money](0007-fulfillment-apart-from-money.md)
