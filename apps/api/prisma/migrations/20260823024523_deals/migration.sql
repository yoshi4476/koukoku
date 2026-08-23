-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'lead',
    "value" INTEGER NOT NULL DEFAULT 0,
    "gross_margin_pct" INTEGER NOT NULL DEFAULT 30,
    "source" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deals_tenant_id_client_id_created_at_idx" ON "deals"("tenant_id", "client_id", "created_at");
