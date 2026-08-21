-- CreateTable
CREATE TABLE "ab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL DEFAULT 'cvr',
    "status" TEXT NOT NULL DEFAULT 'running',
    "a_label" TEXT NOT NULL,
    "a_impr" INTEGER NOT NULL DEFAULT 0,
    "a_clicks" INTEGER NOT NULL DEFAULT 0,
    "a_conv" INTEGER NOT NULL DEFAULT 0,
    "b_label" TEXT NOT NULL,
    "b_impr" INTEGER NOT NULL DEFAULT 0,
    "b_clicks" INTEGER NOT NULL DEFAULT 0,
    "b_conv" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ab_tests_tenant_id_created_at_idx" ON "ab_tests"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
