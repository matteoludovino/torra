-- CreateEnum
CREATE TYPE "Role" AS ENUM ('customer', 'admin');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('verify_email', 'reset_password');

-- CreateTable
CREATE TABLE "sandboxes" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "sandboxId" UUID,
    "dueAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'customer',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "sandboxId" UUID,
    "emailOptOuts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suspendedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sent_emails" (
    "id" UUID NOT NULL,
    "sandboxId" UUID,
    "userId" UUID,
    "to" VARCHAR(254) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sent_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "targetType" VARCHAR(30) NOT NULL,
    "targetId" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "sandboxId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sandboxes_expiresAt_idx" ON "sandboxes"("expiresAt");

-- CreateIndex
CREATE INDEX "outbox_events_processedAt_failedAt_dueAt_idx" ON "outbox_events"("processedAt", "failedAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_sandboxId_idx" ON "users"("sandboxId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_tokenHash_key" ON "email_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_tokens_userId_purpose_idx" ON "email_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "sent_emails_sandboxId_createdAt_idx" ON "sent_emails"("sandboxId", "createdAt");

-- CreateIndex
CREATE INDEX "sent_emails_userId_createdAt_idx" ON "sent_emails"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_entries_sandboxId_createdAt_idx" ON "audit_entries"("sandboxId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "sandboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit log is append-only: no UPDATE, no DELETE, no TRUNCATE. The one way out is removing whole
-- sandboxes (and tests resetting the database), which set torra.purge for their own transaction.
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('torra.purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
  END IF;
  RAISE EXCEPTION 'the audit log is append-only (% on %)', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "audit_entries_append_only" BEFORE UPDATE OR DELETE ON "audit_entries"
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER "audit_entries_no_truncate" BEFORE TRUNCATE ON "audit_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

-- Customers always live in a sandbox; the store's own admins (who run the shared catalog) may not.
ALTER TABLE "users" ADD CONSTRAINT "users_customers_in_a_sandbox"
  CHECK ("role" = 'admin' OR "sandboxId" IS NOT NULL);
