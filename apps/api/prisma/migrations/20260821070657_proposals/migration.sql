-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_payload" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "risk" TEXT NOT NULL DEFAULT '',
    "confidence" TEXT NOT NULL DEFAULT 'mid',
    "simulation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source_audit_id" TEXT,
    "source_rank" INTEGER,
    "created_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "execution_note" TEXT NOT NULL DEFAULT '',
    "rollback_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposals_tenant_id_status_created_at_idx" ON "proposals"("tenant_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
