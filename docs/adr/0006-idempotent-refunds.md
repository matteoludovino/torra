# 6. Refunds: the row first, and a lookup before any retry

**Status:** accepted

## Context

Refunding twice is the costliest bug a store can have. Stripe's idempotency keys protect retries for 24
hours; a refund whose answer was lost and that is retried later (the API asleep, Stripe down) has no such
protection.

## Decision

- The refund is a row before Stripe hears of it: its id is the idempotency key and goes in the refund's
  metadata. It counts against what was paid from that moment.
- A retry of a refund older than a minute first lists the PaymentIntent's refunds and looks for its id in
  their metadata; only if it isn't there is a new refund requested, with the same key.
- Stripe refusals are final (the row fails and stops counting); network failures leave it pending for a
  sweep. Refunds made in Stripe's Dashboard (no id of ours) become rows when seen.

## Consequences

- A lost answer, even days later, never refunds twice; a test loses the answer and expires the key.
- The store's refunded total always matches Stripe's, including refunds made outside the app.
