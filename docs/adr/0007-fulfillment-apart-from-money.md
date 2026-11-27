# 7. Fulfillment status kept apart from money

**Status:** accepted

## Context

A single status can't describe an order that was shipped and then partly refunded, or delivered and then
disputed. Mixing them makes every new money event a new status, and every status a special case.

## Decision

- `status` is the order's progress: waiting for payment, paid, preparing, shipped (with a tracking code),
  delivered, cancelled, expired.
- Money is separate: `amountPaidCents`, `amountRefundedCents` (from the refunds), `disputeStatus`.
  "Fully refunded" is derived, not a status.
- Cancelling a paid order is a full refund (goods back to stock) followed by the status change; a shipped
  order isn't cancelled, its returned items are refunded.
- Only orders with something to ship are prepared, shipped or delivered; digital items are delivered by
  their downloads, which a full refund revokes.

## Consequences

- Any refund or dispute can happen at any point of fulfillment without new statuses.
- Screens show two things side by side (where it is, what was paid back), which matches how stores work.
