-- CV受信トークンを専用テーブルへ分離 (F-55)。
-- 公開エンドポイントはテナント文脈を持てないため、RLS対象外のテーブルで token 解決する
-- (token 自体が十分に長い秘密。ShareLink と同じ方式)。
DROP INDEX IF EXISTS "measurement_configs_ingest_token_idx";
ALTER TABLE "measurement_configs" DROP COLUMN IF EXISTS "ingest_token";

CREATE TABLE "ingest_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ingest_tokens_token_key" ON "ingest_tokens"("token");
CREATE UNIQUE INDEX "ingest_tokens_tenant_id_client_id_key" ON "ingest_tokens"("tenant_id", "client_id");
