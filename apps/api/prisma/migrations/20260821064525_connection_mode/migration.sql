-- AlterTable
ALTER TABLE "media_connections" ADD COLUMN     "error_message" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "last_sync_rows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'mock';
