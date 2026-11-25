import { type DynamicModule, Global, Module } from "@nestjs/common";
import { RateLimiter } from "../common/rate-limiter.ts";
import { Audit } from "../admin/audit.ts";
import { Scheduler } from "../scheduler/scheduler.service.ts";
import { Clock } from "../time/clock.ts";
import { OutboxService } from "./outbox.service.ts";

/** Time, the scheduler, the outbox, rate limits and the audit log, shared by every feature module. Tests pass a clock of their own. */
@Global()
@Module({})
export class CoreModule {
  static with(clock: Clock = new Clock()): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: Clock, useValue: clock }, Scheduler, OutboxService, RateLimiter, Audit],
      exports: [Clock, Scheduler, OutboxService, RateLimiter, Audit],
    };
  }
}
