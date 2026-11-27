# 2. A payment gateway port, with a deterministic fake

**Status:** accepted

## Context

Tests must cover declines, 3-D Secure abandoned, payments processing for a while, refunds that fail days
later, disputes, lost answers and expired idempotency keys. Stripe's test mode can produce some of these,
slowly and not on demand, and CI shouldn't depend on a network call or a secret for every pull request.

## Decision

- `PaymentGateway` is the only way the API talks to a payment provider, in the store's own terms
  (intents, refunds, disputes). `StripeGateway` maps it to the official SDK, with a pinned API version.
- `FakeGateway` keeps PaymentIntents and refunds in memory the way Stripe does (idempotency keys, refused
  requests, asynchronous rejections) and lets tests decide what happens next: `settle`, `settleRefund`,
  `refundInDashboard`, `dispute`, `failNextRefund`, `loseNextRefundResponse`, `forgetKeys`.
- Without Stripe keys (development, tests, end-to-end runs) the fake stands in, and the order page shows a
  simulated card; production requires Stripe. Live keys are refused everywhere.
- Contract tests run the Stripe adapter against Stripe itself when a test key is present (CI on main).

## Consequences

- The integration and end-to-end suites are fast, deterministic and secret-free.
- The fake can drift from Stripe; the contract tests are what keep it honest.
