-- CreateTable
CREATE TABLE "lift_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'holdback',
    "holdout_pct" INTEGER NOT NULL DEFAULT 10,
    "start_date" TEXT,
    "end_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "exposed_audience" INTEGER,
    "exposed_conversions" DOUBLE PRECISION,
    "exposed_cost" DOUBLE PRECISION,
    "control_audience" INTEGER,
    "control_conversions" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lift_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lift_tests_tenant_id_created_at_idx" ON "lift_tests"("tenant_id", "created_at");
