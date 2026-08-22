-- CreateTable
CREATE TABLE "measurement_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "ga4_measurement_id" TEXT NOT NULL DEFAULT '',
    "ga4_property_id" TEXT NOT NULL DEFAULT '',
    "meta_pixel_id" TEXT NOT NULL DEFAULT '',
    "server_side_enabled" BOOLEAN NOT NULL DEFAULT false,
    "enhanced_conversions" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "measurement_configs_tenant_id_client_id_key" ON "measurement_configs"("tenant_id", "client_id");
