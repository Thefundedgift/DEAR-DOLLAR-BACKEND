-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "bank_detail_id" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "upi_id" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "payout_reference" TEXT,
    "processed_by" TEXT,
    "processed_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "withdrawals_status_created_at_idx" ON "withdrawals"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_user_id_idempotency_key_key" ON "withdrawals"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
