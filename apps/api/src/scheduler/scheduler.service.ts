import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ENV, type Env } from "../env.ts";
import { Clock } from "../time/clock.ts";

/** Work that becomes due over time: run it, and say when there will be more. */
export interface Sweep {
  readonly name: string;
  /** Does what's due at `now`; returns how many items it handled. Must be idempotent. */
  run(now: Date): Promise<number>;
  /** When the next item becomes due (null: nothing pending). */
  nextDueAt(now: Date): Promise<Date | null>;
}

const MIN_WAIT_MS = 1000;
const MAX_WAIT_MS = 5 * 60 * 1000;

/**
 * Runs time-based work inside the API process, with no external queue or cron: on start, then again when
 * the next item is due (at most five minutes later), or at once when new work is written (`kick`). A free
 * plan's sleeping server catches up on wake-up; rules that must hold even before then are also checked
 * when the data is read.
 */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Scheduler");
  private readonly sweeps: Sweep[] = [];
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  register(sweep: Sweep): void {
    this.sweeps.push(sweep);
  }

  onApplicationBootstrap(): void {
    if (this.env.SCHEDULER) this.kick();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** New work was written: run now (or right after the current run). */
  kick(): void {
    if (!this.env.SCHEDULER || this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    clearTimeout(this.timer);
    this.running = this.cycle().finally(() => {
      this.running = null;
      if (this.again && !this.stopped) {
        this.again = false;
        this.kick();
      }
    });
  }

  /** Runs every sweep until nothing is due (tests call this directly, with the scheduler off). */
  async runOnce(): Promise<number> {
    let handled = 0;
    // Passes until one finds nothing: a sweep can make work for another (a due digest becomes an
    // outbox event).
    for (let pass = await this.pass(); pass > 0; pass = await this.pass()) handled += pass;
    return handled;
  }

  private async pass(): Promise<number> {
    let handled = 0;
    for (const sweep of this.sweeps) {
      try {
        for (
          let done = await sweep.run(this.clock.now());
          done > 0;
          done = await sweep.run(this.clock.now())
        ) {
          handled += done;
        }
      } catch (error) {
        this.logger.error(`${sweep.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return handled;
  }

  private async cycle(): Promise<void> {
    await this.runOnce();
    if (this.stopped) return;
    const now = this.clock.now();
    const next = await Promise.all(this.sweeps.map((s) => s.nextDueAt(now).catch(() => null)));
    const soonest = Math.min(...next.filter((d): d is Date => d !== null).map((d) => d.getTime()), Infinity);
    const wait = Math.min(Math.max(soonest - now.getTime(), MIN_WAIT_MS), MAX_WAIT_MS);
    this.timer = setTimeout(() => this.kick(), wait);
    this.timer.unref();
  }
}
