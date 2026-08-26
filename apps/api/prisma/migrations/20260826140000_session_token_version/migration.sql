-- セッション世代 (F-62)。パスワード再設定で +1 し、それ以前に発行されたJWTを一括で無効化する。
-- JWTの iat は秒精度しか持たないため、時刻比較では「再設定と同じ秒に発行されたセッション」を
-- 正しく扱えない (通せば乗っ取り側が生き残り、弾けば直後の再ログインが失敗する)。世代番号なら曖昧さが無い。
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
