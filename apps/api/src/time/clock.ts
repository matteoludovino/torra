import { Injectable } from "@nestjs/common";

/** The current time, injectable: every time-based rule asks this, so tests can move time forward. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock that only moves when told to (tests). */
export class FakeClock extends Clock {
  constructor(private current = new Date("2026-11-23T12:00:00.000Z")) {
    super();
  }

  override now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}
