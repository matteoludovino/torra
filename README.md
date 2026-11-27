# Torra

An online store for a specialty-coffee roaster: coffee with variants (weight, grind), brewing gear, and
digital courses and e-books. It takes real card payments through Stripe in test mode (Payment Element,
webhooks, refunds), runs orders from cart to delivery, and gives the store an admin panel.

> **Status:** being built in stages (see the roadmap). The interface is in Brazilian Portuguese; code, docs
> and commits are in English.

## What works so far

- **Accounts.** Sign up (which signs in at once), sign in and out, confirm the address by an emailed link
  (encouraged, never required to buy), reset a forgotten password. Admins of the store are created from
  the command line, never by a route.
- **Every customer in a sandbox of their own.** A customer sees the shared catalog and only what they
  wrote: cart, orders and stock reservations. One customer's checkout can never
  hold stock that another sees, and a one-click demo visitor (stage 9) is a customer whose sandbox goes
  after a day.
- **A storefront.** Coffees in every weight and grind, brewing gear and digital courses, on shelves by
  category, with search that ignores accents ("ceramica" finds "cerâmica") and product pages where each
  variant shows its price and what's left ("Últimas 3 unidades", "Esgotado nesta opção").
- **Stock that explains itself.** Every change is an append-only movement; the level per variant is kept
  by a trigger, can't be written directly and can't go below zero. Each customer's first touch of a
  shared variant copies its stock into their sandbox; from then on only their copy moves, so nobody's
  cart can hold anyone else's units, and the shared catalog's stock never moves because of a customer.
- **A cart that tells the truth.** Visitors fill one behind a cookie of its own (only its hash is stored);
  signing in or up moves it into the account's. Prices always come from the catalog, never from the
  browser; a line only remembers the price the customer saw, to say when it changed. Quantities stay
  within what's left in the customer's corner of the store, ten per line, one of a digital product, and
  the cart flags what needs attention (sold out, fewer left, new price) before checkout. Accounts without
  a sandbox (the store's admins) don't shop: they'd be buying the shared stock.
- **Shipping, coupons and totals, priced on the server.** A CEP's state comes from the ViaCEP directory
  (cached, with a short timeout; if it doesn't answer, the customer picks the state). Shipping is a table
  by region and started kilo, economy or express, with business-day estimates, and economy is free from
  R$ 300 in products after the discount. Coupons take a percentage (rounded down) or an amount off the
  products, never off shipping, with dates, a minimum, a total limit counted in each customer's own
  corner of the store, and "once per customer" (kept by a partial unique index). Totals come from one
  pure function, property-tested: the discount is shared out among the lines by largest remainder, in
  exact integers, so refunding one line refunds exactly its share.
- **Orders that hold what they promise.** Checkout asks for the delivery address (the CEP fills it in, and
  the state must be the CEP's: shipping is priced by it), the shipping service and the coupon, and places
  an order that freezes the cart's lines at today's prices. For 30 minutes it holds its stock in the
  customer's corner of the store and its coupon use, then expires and gives both back (a sweep inside the
  API; the order already reads as expired before it runs). Everything happens in one transaction under
  the cart's lock, with locks always taken in the same order (cart, stock by variant, coupon): a double
  click gets the same order, changing shipping, coupon, address or cart replaces the waiting order, and
  the last units or a coupon's last place go to exactly one of the customers racing for them. The
  customer can cancel a waiting order, and follows each one on its own page: status, a countdown, a
  timeline, and a receipt by email.
- **Order invariants in the database.** Totals add up (checked at commit by deferred constraint
  triggers: the lines' sum, the discount's shares, shipping exactly when something ships); what was
  bought and for how much can't change after the fact; status moves only along allowed transitions (a
  paid order never goes back to waiting); an order, its lines and its stock movements stay in its
  customer's sandbox; its timeline is append-only.
- **Card payments through Stripe, in test mode.** The order page carries Stripe's Payment Element (3-D
  Secure in place, Stripe's own decline messages, the test cards listed beside it). Each order has one
  PaymentIntent, created once by an idempotency key; a declined card leaves it waiting for another. One
  function decides an order's payment state, and it always asks Stripe for the PaymentIntent as it is now:
  webhooks (signature-checked, kept once, handled through the outbox), the page's return from the card form
  and a sweep two minutes later only make it run, so a lost, repeated, out-of-order or forged event changes
  nothing. A PaymentIntent that doesn't match its order (amount, currency, order, deployment) is never
  taken as paid. Stripe is never called inside a database transaction.
- **No order closes while it can still be paid.** Expiring, cancelling or replacing an order cancels its
  PaymentIntent first; if Stripe says it was paid meanwhile, the order is paid instead, and a payment still
  processing keeps it open (the page follows it and settles on its own). A payment that arrives anyway for
  a closed order is refunded in full, once. An order that costs nothing is settled without Stripe.
- **Paid means sold.** The units the order held stay sold, its lines leave the cart, a receipt goes out,
  and digital items can be downloaded at once: a PDF made on request and licensed to the buyer by name,
  behind a signed link that works for an hour and needs no session, with each download counted.
- **An admin panel for running the store.** An overview (sales over 7 and 30 days, orders by status,
  what's waiting to ship, payments under review, stock running out, and outbox work that gave up, with a
  retry); orders to find by number, name or email, each with what Stripe has (asked again on request) and
  its next step: prepare, ship with a tracking code, mark delivered (the customer is emailed and follows
  it on the order page), or cancel while it waits for payment; products and variants to add and price,
  stock to correct with a reason, coupons to create and switch off, customers with what they've spent.
  Every action goes into the append-only audit log, which the panel lists.
- **Admins see their own corner.** The store's admins (created from the command line) run the real store:
  every customer's orders, labelled by origin, and the shared catalog and stock. A demo's admin runs only
  that demo: its orders, products and coupons of its own, and its own copy of the stock; the shared
  catalog is read-only to it. Scope is one rule in the API, checked by tests from both sides.
- **Email people can control.** Receipts and account email always go; order progress updates carry a
  signed unsubscribe link and the one-click header email clients turn into a button.

## Architecture

An npm-workspaces monorepo, built on the infrastructure of [Lance](https://github.com/matteoludovino/lance):

| Package           | What it is                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `apps/api`        | NestJS 12 on Fastify, Prisma 7 (Rust-free client, node-postgres), PostgreSQL    |
| `apps/web`        | Next.js 16 (App Router) + Tailwind 4                                            |
| `packages/shared` | Zod schemas and rules used by both sides (validated in the API by a small pipe) |

- **Sessions** are database rows behind a random httpOnly, SameSite=Lax cookie (only its SHA-256 is
  stored). State-changing requests must carry the web app's `Origin`. Passwords use Argon2id; sign-ins,
  sign-ups and emails are rate-limited, and each sandbox gets 60 writes a minute.
- **Time and side effects:** an injectable clock, and a transactional outbox drained by a scheduler inside
  the API (no external queue for a free-plan server that sleeps).
- **An append-only audit log** of what admins do: the database refuses to change or delete it.

- **Payments behind a port:** `PaymentGateway`, with a Stripe adapter (the official SDK, API version
  `2026-10-28.endive` pinned, requests spaced to stay under test mode's rate limit) and a deterministic fake
  that keeps PaymentIntents and refunds the way Stripe does, idempotency keys included. Without Stripe keys
  (development, tests, end-to-end runs) the fake stands in, and the order page shows a simulated card form;
  in production Stripe is required, and live keys are refused everywhere.
- **Fulfillment rules in the database too:** only orders with something to ship are prepared, shipped
  (with a tracking code) or delivered, in that order; a stock correction carries its reason.
- **Money rules in the database too:** a paid order that cost something has a PaymentIntent with no
  mismatch; its PaymentIntent can't change once it leaves "waiting for payment"; downloads exist only for a
  paid order's digital items.

The plan ahead, by design: fulfillment kept apart from money, and refund caps enforced by the database,
like order totals and stock already are.

## Running locally

Requirements: Node.js 22.18+, Docker.

```bash
npm install
npm run db:up                      # PostgreSQL on :5440, Mailpit (email catcher) on :8026
cp .env.example apps/api/.env
npm run db:migrate -w @torra/api
npm run db:seed -w @torra/api      # the catalog (12 products, 53 variants, their stock) and 2 coupons
npm run dev                        # API on :8050, web on http://localhost:3040
```

Payments run on the fake gateway until Stripe test keys are set in `apps/api/.env` (see `.env.example`):
a Stripe sandbox's `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`, and for webhooks the secret printed
by `stripe listen --forward-to localhost:8050/api/payments/webhook` (without it, payments still settle:
the page and a sweep ask Stripe). `npm test` also checks the Stripe adapter against Stripe itself when
`STRIPE_SECRET_KEY` is exported (CI does, on main).

| Script                                                    | Does                                                |
| --------------------------------------------------------- | --------------------------------------------------- |
| `npm test`                                                | All tests (API tests run against a real PostgreSQL) |
| `npm run build && npm run e2e`                            | Playwright end-to-end tests, with real email        |
| `npm run lint` / `typecheck` / `format:check`             | Across all workspaces                               |
| `docker build -f apps/api/Dockerfile .`                   | API image (applies migrations on start)             |
| `npm run admin:create -w @torra/api -- EMAIL "Full Name"` | An admin of the store, with a set-password link     |

## Roadmap

1. ✅ Base: monorepo, accounts with a sandbox per customer, outbox, scheduler, audit log, CI
2. ✅ Catalog and stock (variants, stock levels per sandbox, storefront, search)
3. ✅ Cart (visitor and customer carts, server prices, merge on sign-in)
4. ✅ Shipping by CEP, coupons and totals
5. ✅ Orders with stock reservation
6. ✅ Stripe payments (Payment Element, webhooks, reconciliation, digital downloads)
7. ✅ Admin panel (orders and fulfillment, products and stock, coupons)
8. Refunds and disputes
9. One-click demo, deploy, README with GIF, ADRs
