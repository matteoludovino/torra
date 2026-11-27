# 3. Stripe is never called inside a database transaction

**Status:** accepted

## Context

Database transactions here are retried on serialization failures and deadlocks, and they hold row locks
(the cart, stock levels, the coupon, the order). A Stripe call inside one could run twice on a retry, or
hold locks for as long as a network request takes.

## Decision

- Write and commit first, call Stripe, then apply the answer with a conditional update.
- Creating a PaymentIntent: the order is read, Stripe is called with an idempotency key derived from the
  order, then the id is stored only if the order is still waiting for payment (otherwise the new
  PaymentIntent is cancelled).
- Closing an order (expiry, cancellation, replacement) cancels its PaymentIntent first, outside the
  transaction; the transaction then closes the order only if its PaymentIntent is the one let go of, and
  starts over if a new one appeared meanwhile.
- Refunds: the refund row is committed before Stripe is asked (see ADR 6).

## Consequences

- No duplicate charges or refunds from retried transactions, and no locks held across the network.
- Each flow has a window between commit and Stripe's answer; sweeps and reconciliation close it.
