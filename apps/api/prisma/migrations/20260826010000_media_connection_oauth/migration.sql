-- 媒体OAuth実接続 (F-54): リフレッシュトークン(暗号化)とMCC IDを保持する
ALTER TABLE "media_connections" ADD COLUMN "refresh_token_enc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "media_connections" ADD COLUMN "login_customer_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "media_connections" ADD COLUMN "authorized_at" TIMESTAMP(3);
