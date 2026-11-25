import { HttpException, Injectable } from "@nestjs/common";
import { Clock } from "../time/clock.ts";

export interface Limit {
  /** At most this many hits… */
  max: number;
  /** …per window of this many milliseconds. */
  windowMs: number;
}

/**
 * Fixed-window counters in memory (one instance serves the API; a restart forgets them, which only
 * forgives). Keys name what is limited: "login:ip:1.2.3.4", "login:email:ana@x.com"…
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; hits: number }>();

  constructor(private readonly clock: Clock) {}

  /** Counts a hit; over the limit, answers 429 with how long to wait. */
  hit(key: string, limit: Limit): void {
    const retryAfterMs = this.take(key, limit);
    if (retryAfterMs > 0) throw tooMany(retryAfterMs);
  }

  /** Throws if the key is already over its limit, without counting (check before costly work). */
  check(key: string, limit: Limit): void {
    const now = this.clock.now().getTime();
    const window = this.windows.get(key);
    if (window && now - window.startedAt < limit.windowMs && window.hits >= limit.max) {
      throw tooMany(window.startedAt + limit.windowMs - now);
    }
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private take(key: string, { max, windowMs }: Limit): number {
    const now = this.clock.now().getTime();
    if (this.windows.size > 50_000) this.prune(now, windowMs);
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= windowMs) {
      window = { startedAt: now, hits: 0 };
      this.windows.set(key, window);
    }
    window.hits += 1;
    return window.hits > max ? window.startedAt + windowMs - now : 0;
  }

  private prune(now: number, windowMs: number): void {
    for (const [key, window] of this.windows)
      if (now - window.startedAt >= windowMs) this.windows.delete(key);
  }
}

function tooMany(retryAfterMs: number): HttpException {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const minutes = Math.ceil(seconds / 60);
  return new HttpException(
    {
      code: "rate_limited",
      message:
        seconds < 60
          ? "Muitas tentativas. Espere alguns segundos."
          : `Muitas tentativas. Tente de novo em ${minutes} minuto${minutes > 1 ? "s" : ""}.`,
      retryAfter: seconds,
    },
    429,
  );
}
