// Usage: npm run db:seed -w @torra/api (uses DATABASE_URL from apps/api/.env, or the environment's)
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { seedCatalog } from "../src/seed/seed.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }) });
try {
  const { products, variants, coupons } = await seedCatalog(db);
  console.log(`Seeded the catalog: ${products} products, ${variants} variants, ${coupons} coupons.`);
} finally {
  await db.$disconnect();
}
