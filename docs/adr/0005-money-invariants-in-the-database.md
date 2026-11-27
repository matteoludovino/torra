# 5. Money rules enforced by the database

**Status:** accepted

## Context

Orders, payments and refunds are written by several paths (checkout, webhooks, sweeps, the admin panel,
the demo's story). A rule kept only in application code is one bug away from being broken.

## Decision

The database enforces, independently of the code:

- an order's total is subtotal − discount + shipping; its lines add up to the subtotal and its discount
  shares to the discount (deferred trigger, at commit); something ships exactly when there's an address;
- what was bought, and for how much, never changes; status moves only along allowed transitions;
- a paid order that cost something was paid by a PaymentIntent that matched it, which then can't change;
- what's refunded (pending or done) never exceeds what was paid, kept one change at a time by trigger so
  concurrent refunds can't overdraw; refund lines give back no more than was bought, shipping once;
- orders, their lines and their stock movements stay in their customer's sandbox.

## Consequences

- A wrong code path fails at commit instead of corrupting money; mutation tests remove each guard and
  watch the suite fail.
- Fixing a mistake means a new record (a refund, a correction), never an edit.
