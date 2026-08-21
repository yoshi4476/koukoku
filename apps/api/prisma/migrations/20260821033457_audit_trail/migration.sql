-- CreateTable
CREATE TABLE "audit_trail" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL DEFAULT '',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_trail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_trail_tenant_id_created_at_idx" ON "audit_trail"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
