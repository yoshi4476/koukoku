import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/errors';
import { UPLOAD_DIR } from './projects/upload.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Slack署名検証のため生ボディを保持する
    rawBody: true,
  });
  app.use(cookieParser());
  // アップロードした画像・動画を /uploads/ で配信 (表示のみ。URLはcuidで推測困難)
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads/' });
  // 許可オリジン。WEB_ORIGIN はカンマ区切りで複数指定できる (本番URL + プレビュー等)。
  // Vercelのプレビューは毎回URLが変わるため、VERCEL_PREVIEW_SUFFIX で末尾一致も許可できる。
  const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const previewSuffix = process.env.VERCEL_PREVIEW_SUFFIX?.trim();
  app.enableCors({
    origin(origin, cb) {
      // サーバ間呼出やcurl等 (Originなし) は許可する
      if (!origin) return cb(null, true);
      const o = origin.replace(/\/$/, '');
      if (allowed.includes(o)) return cb(null, true);
      if (previewSuffix && o.endsWith(previewSuffix)) return cb(null, true);
      return cb(null, false); // 例外にせず、CORSヘッダを付けないことで拒否する
    },
    credentials: true,
    allowedHeaders: ['content-type', 'x-tenant-id'],
  });
  app.useGlobalFilters(new AppExceptionFilter());
  // PORT はホスティング(Railway等)が注入する。ローカルは API_PORT / 4000
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  // コンテナ環境では 0.0.0.0 で待ち受けないと外部から到達できない
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`ADGRID API listening on port ${port}`);
}
bootstrap();
