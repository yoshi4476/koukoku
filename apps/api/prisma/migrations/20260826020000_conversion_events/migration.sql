-- CV受信トークン (F-55)
ALTER TABLE "measurement_configs" ADD COLUMN "ingest_token" TEXT NOT NULL DEFAULT '';
CREATE INDEX "measurement_configs_ingest_token_idx" ON "measurement_configs"("ingest_token");

-- サーバーサイドCV: 受信イベントと転送結果
CREATE TABLE "conversion_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL DEFAULT 'Purchase',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "email_hash" TEXT NOT NULL DEFAULT '',
    "phone_hash" TEXT NOT NULL DEFAULT '',
    "gclid" TEXT NOT NULL DEFAULT '',
    "fbclid" TEXT NOT NULL DEFAULT '',
    "fbp" TEXT NOT NULL DEFAULT '',
    "source_url" TEXT NOT NULL DEFAULT '',
    "user_agent" TEXT NOT NULL DEFAULT '',
    "ip_hash" TEXT NOT NULL DEFAULT '',
    "meta_status" TEXT NOT NULL DEFAULT 'skipped',
    "ga4_status" TEXT NOT NULL DEFAULT 'skipped',
    "error_message" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversion_events_tenant_id_client_id_event_id_key" ON "conversion_events"("tenant_id", "client_id", "event_id");
CREATE INDEX "conversion_events_tenant_id_client_id_occurred_at_idx" ON "conversion_events"("tenant_id", "client_id", "occurred_at");

-- テナント分離
ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversion_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
