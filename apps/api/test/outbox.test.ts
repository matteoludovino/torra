import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OutboxService, type OutboxRecord } from "../src/outbox/outbox.service.ts";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { Scheduler } from "../src/scheduler/scheduler.service.ts";
import { FakeClock } from "../src/time/clock.ts";
import { testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
const outbox = app.get(OutboxService);
const scheduler = app.get(Scheduler);
afterAll(() => app.close());

const seen: OutboxRecord[] = [];
let failing = 0;
outbox.handle("test.ok", async (event) => {
  seen.push(event);
});
outbox.handle("test.flaky", async () => {
  if (failing-- > 0) throw new Error("not now");
});
outbox.handle("test.slow", async (event) => {
  await new Promise((r) => setTimeout(r, 30));
  seen.push(event);
});

beforeEach(async () => {
  await db.outboxEvent.deleteMany();
  seen.length = 0;
});

describe("outbox", () => {
  it("records an event only if its transaction commits", async () => {
    await db.$transaction(async (tx) => outbox.add(tx, "test.ok", { n: 1 }));
    await expect(
      db.$transaction(async (tx) => {
        await outbox.add(tx, "test.ok", { n: 2 });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    await scheduler.runOnce();
    expect(seen.map((e) => e.payload)).toEqual([{ n: 1 }]);
  });

  it("handles each event once, even with sweeps running side by side", async () => {
    await db.$transaction(async (tx) => {
      for (let n = 0; n < 80; n++) await outbox.add(tx, "test.slow", { n });
    });
    await Promise.all(Array.from({ length: 8 }, () => outbox.drain(clock.now())));
    await scheduler.runOnce();
    const handled = seen.map((e) => (e.payload as { n: number }).n).sort((a, b) => a - b);
    expect(handled).toEqual(Array.from({ length: 80 }, (_, n) => n));
  });

  it("skips events another sweep is in the middle of claiming, without waiting for it", async () => {
    await db.$transaction(async (tx) => {
      for (let n = 0; n < 5; n++) await outbox.add(tx, "test.ok", { n });
    });
    // Another sweep (or process) holds three rows mid-claim and lets go only after a while.
    let release = () => {};
    const holding = new Promise<void>((resolve) => (release = resolve));
    let locked = () => {};
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const other = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM outbox_events ORDER BY id LIMIT 3 FOR UPDATE`;
        locked();
        await holding;
      },
      { timeout: 10_000 },
    );
    await ready;
    const letGo = setTimeout(release, 1500);
    const started = Date.now();
    const taken = await outbox.drain(clock.now());
    expect(Date.now() - started).toBeLessThan(1000);
    expect(taken).toBe(2);
    clearTimeout(letGo);
    release();
    await other;
  });

  it("waits for an event's due time", async () => {
    await db.$transaction(async (tx) =>
      outbox.add(tx, "test.ok", {}, { dueAt: new Date(clock.now().getTime() + 60_000) }),
    );
    await scheduler.runOnce();
    expect(seen).toHaveLength(0);
    clock.advance(60_000);
    await scheduler.runOnce();
    expect(seen).toHaveLength(1);
  });

  it("retries a failing handler with backoff, and gives up after eight attempts", async () => {
    failing = 2;
    await db.$transaction(async (tx) => outbox.add(tx, "test.flaky", {}));
    await scheduler.runOnce(); // attempt 1 fails
    let row = await db.outboxEvent.findFirstOrThrow();
    expect(row).toMatchObject({ attempts: 1, processedAt: null, lastError: "not now" });
    expect(row.dueAt.getTime() - clock.now().getTime()).toBe(60_000);
    clock.advance(60_000);
    await scheduler.runOnce(); // attempt 2 fails, next in 2 min
    clock.advance(120_000);
    await scheduler.runOnce(); // attempt 3 succeeds
    row = await db.outboxEvent.findFirstOrThrow();
    expect(row.processedAt).not.toBeNull();

    failing = 100;
    await db.$transaction(async (tx) => outbox.add(tx, "test.flaky", { stubborn: true }));
    for (let i = 0; i < 10; i++) {
      await scheduler.runOnce();
      clock.advance(60 * 60_000);
    }
    const stubborn = await db.outboxEvent.findFirstOrThrow({
      where: { payload: { equals: { stubborn: true } } },
    });
    expect(stubborn).toMatchObject({ attempts: 8, processedAt: null });
    expect(stubborn.failedAt).not.toBeNull();
  });

  it("tells the scheduler when the next event is due", async () => {
    const due = new Date(clock.now().getTime() + 5 * 60_000);
    await db.$transaction(async (tx) => outbox.add(tx, "test.ok", {}, { dueAt: due }));
    const next = await db.outboxEvent.findFirstOrThrow();
    expect(next.dueAt).toEqual(due);
  });
});
