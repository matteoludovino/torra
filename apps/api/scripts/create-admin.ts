// Usage: npm run admin:create -w @torra/api -- someone@example.com "Their Name"
// Creates an admin of the store (no sandbox: they run the shared catalog) and prints a one-time link to
// set their password. Deliberately a command, not a route: making an admin takes access to the database.
// No password passes through the terminal or its history, and it works without SMTP.
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { emailInput, personName } from "@torra/shared";
import { uuidv7 } from "../src/common/ids.ts";
import { hashToken, newToken } from "../src/common/secrets.ts";
import { TOKEN_LIFETIME } from "../src/auth/email-tokens.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const parsedEmail = emailInput.safeParse({ email: process.argv[2] ?? "" });
const parsedName = personName.safeParse(process.argv[3] ?? "");
if (!parsedEmail.success || !parsedName.success) {
  console.error('Usage: npm run admin:create -w @torra/api -- someone@example.com "Their Name"');
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }) });
try {
  const email = parsedEmail.data.email;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && (existing.role !== "admin" || existing.sandboxId !== null)) {
    console.error(`${email} already belongs to a customer: use another address for the admin.`);
    process.exitCode = 1;
  } else {
    const now = new Date();
    const id = existing?.id ?? uuidv7(now.getTime());
    if (!existing) {
      await db.user.create({
        data: { id, email, name: parsedName.data, role: "admin", emailVerifiedAt: now, createdAt: now },
      });
    }
    const token = newToken();
    await db.emailToken.create({
      data: {
        id: uuidv7(now.getTime()),
        tokenHash: hashToken(token),
        userId: id,
        purpose: "reset_password",
        createdAt: now,
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME.reset_password),
      },
    });
    const web = process.env["WEB_URL"] ?? "http://localhost:3040";
    console.log(`${email} is an admin. Set the password within an hour: ${web}/redefinir-senha#t=${token}`);
  }
} finally {
  await db.$disconnect();
}
