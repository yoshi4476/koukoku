import { join } from 'path';

/** アップロード先ディレクトリ (実体保存)。/uploads/ で静的配信される */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

/** 許可する画像・動画のMIMEと拡張子。ここに無いものは拒否する */
export const ALLOWED_UPLOAD: Record<string, { ext: string; kind: 'image' | 'video' }> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
};

/** 上限サイズ (バイト)。画像/動画共通で 50MB */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
