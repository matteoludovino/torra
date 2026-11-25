import { HttpException, Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

// OWASP's Argon2id baseline: 19 MiB, 2 passes, 1 lane.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const MAX_RUNNING = 2;
const MAX_WAITING = 40;

/**
 * Argon2id hashing with a cap on how many run at once. Each one is deliberately expensive (CPU and
 * 19 MiB); on a small instance a burst of logins would otherwise starve everything else. Beyond the
 * queue, callers get 503 instead of piling up.
 */
@Injectable()
export class Passwords {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  /** Verified against when the email is unknown, so both answers take as long. */
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return this.limited(() => hash(password, OPTIONS));
  }

  verify(passwordHash: string | null, password: string): Promise<boolean> {
    return this.limited(async () => {
      if (passwordHash) return verify(passwordHash, password).catch(() => false);
      this.dummy ??= hash("not-a-password", OPTIONS);
      await verify(await this.dummy, password).catch(() => false);
      return false;
    });
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_RUNNING) {
      if (this.waiting.length >= MAX_WAITING) {
        throw new HttpException({ code: "busy", message: "Muita gente entrando agora. Tente de novo." }, 503);
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      // Hand the slot straight to the next in line; otherwise free it.
      if (next) next();
      else this.running -= 1;
    }
  }
}
