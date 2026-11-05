-- AlterTable
ALTER TABLE "entries" ADD COLUMN     "automated_creation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "agent_connections" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "reporting_consent" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "revoked_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_capture_receipts" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "source_hash" VARCHAR(64) NOT NULL,
    "entry_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_capture_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_capture_operations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "operation_id" VARCHAR(36) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "receipt_id" TEXT NOT NULL,

    CONSTRAINT "agent_capture_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_connections_token_hash_key" ON "agent_connections"("token_hash");

-- CreateIndex
CREATE INDEX "agent_connections_user_id_created_at_idx" ON "agent_connections"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_capture_receipts_user_id_project_id_source_hash_key" ON "agent_capture_receipts"("user_id", "project_id", "source_hash");

-- CreateIndex
CREATE UNIQUE INDEX "agent_capture_operations_user_id_operation_id_key" ON "agent_capture_operations"("user_id", "operation_id");
