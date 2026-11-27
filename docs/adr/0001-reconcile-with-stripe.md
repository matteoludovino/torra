# 1. One reconciliation decides payment state; webhooks only trigger it

**Status:** accepted

## Context

Stripe tells the store about payments through webhooks, but on a free host that sleeps after 15 minutes,
in Stripe's test mode (which retries less), events can arrive late, twice, out of order, or not at all.
A webhook body is also data from outside: trusting what it says about a payment would make a forged or
stale event able to mark an order paid.

## Decision

- One function, `Payments.reconcile(orderId)`, decides an order's payment state. It always retrieves the
  PaymentIntent from Stripe and applies the transition the current state implies.
- Every path only makes it run: the webhook (signature-checked, kept once by event id, handled through the
  outbox with retries), the payment page's return from the card form, and a sweep that asks again about
  orders not heard of for two minutes.
- From an event, only its type and the id of the object it's about are used.
- A PaymentIntent that doesn't match its order (amount, currency, order id, deployment) is never taken as
  paid; the order is flagged for review.
- Refunds and disputes follow the same rule (`Refunds.reconcile`): Stripe's list of refunds is the truth.

## Consequences

- Lost, repeated, out-of-order and forged events change nothing; tests post each kind, signed.
- Webhooks are an optimization, not a dependency: the store works with none configured.
- Every reconciliation costs one Stripe request; a global spacer keeps the API under test mode's limit.
