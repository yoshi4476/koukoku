-- CreateTable
CREATE TABLE "knowledge_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "industry_code" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'conversion',
    "appeal_axis" TEXT NOT NULL,
    "creative_summary" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "win_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sample_size" INTEGER NOT NULL DEFAULT 0,
    "lift_pct" DOUBLE PRECISION,
    "source_anonymized" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibration_stats" (
    "category" TEXT NOT NULL,
    "adopted" INTEGER NOT NULL DEFAULT 0,
    "dismissed" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calibration_stats_pkey" PRIMARY KEY ("category")
);

-- CreateIndex
CREATE INDEX "knowledge_assets_industry_code_objective_idx" ON "knowledge_assets"("industry_code", "objective");

-- AddForeignKey
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
