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
  wrote: cart, orders and stock reservations (from the next stages on). One customer's checkout can never
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

The plan ahead, by design: a payment gateway port (Stripe and a deterministic fake), one reconciliation
function that always asks Stripe for the current state (webhooks only trigger it), fulfillment kept apart
from money, and order totals and refund caps enforced by the database, like stock already is.

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
5. Orders with stock reservation
6. Stripe payments (Payment Element, webhooks, reconciliation, digital downloads)
7. Admin panel (orders and fulfillment, products and stock, coupons)
8. Refunds and disputes
9. One-click demo, deploy, README with GIF, ADRs
