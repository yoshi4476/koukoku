-- CreateTable
CREATE TABLE "keyword_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'phrase',
    "current_bid" DECIMAL(10,2),
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "conversion_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quality_score" INTEGER,
    "window_days" INTEGER NOT NULL DEFAULT 28,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "keyword_stats_tenant_id_ad_account_id_idx" ON "keyword_stats"("tenant_id", "ad_account_id");

-- CreateIndex
CREATE INDEX "keyword_stats_tenant_id_client_id_idx" ON "keyword_stats"("tenant_id", "client_id");

-- AddForeignKey
ALTER TABLE "keyword_stats" ADD CONSTRAINT "keyword_stats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_stats" ADD CONSTRAINT "keyword_stats_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_stats" ADD CONSTRAINT "keyword_stats_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
