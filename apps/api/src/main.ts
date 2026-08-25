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
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
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
