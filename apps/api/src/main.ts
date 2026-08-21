import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/errors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, allowedHeaders: ['content-type', 'x-tenant-id'] });
  app.useGlobalFilters(new AppExceptionFilter());
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ADGRID API listening on http://localhost:${port}`);
}
bootstrap();
