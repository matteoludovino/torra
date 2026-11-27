# 4. Stock per sandbox, copy-on-write

**Status:** accepted

## Context

Every account is a sandbox: customers see the shared catalog and only what they wrote. If their orders
moved the shared stock, one visitor's demo could sell out the store for everyone, and a real admin's
count would mix with strangers' reservations.

## Decision

- Stock is an append-only list of movements (seed, copy, adjust, reserve, release, restock); a level per
  variant and sandbox follows by trigger, can't be written directly, and can't go below zero.
- The first time a sandbox moves a shared variant's stock, it copies the shared balance into a level of
  its own, under the shared level's row lock; from then on only its copy moves.
- The store's admins move the shared levels; a demo's admin moves its own.

## Consequences

- Nobody's checkout can hold anybody else's units, and removing a demo removes its movements without
  touching the shared stock.
- A sandbox's copy doesn't see later changes to the shared stock; for a day-long demo that's intended.
