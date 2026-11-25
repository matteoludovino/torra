import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { ENV, type Env } from "../env.ts";
import { PrismaClient } from "../generated/prisma/client.ts";

/**
 * The database client: Prisma without its Rust engine, queries through node-postgres. A small pool, since
 * the free database plan caps connections and the instance has little memory.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 5 }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
