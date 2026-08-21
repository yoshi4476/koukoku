-- CreateTable
CREATE TABLE "change_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL DEFAULT '',
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT NOT NULL DEFAULT '',
    "new_value" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_logs_tenant_id_ad_account_id_changed_at_idx" ON "change_logs"("tenant_id", "ad_account_id", "changed_at");

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_logs" ADD CONSTRAINT "change_logs_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
