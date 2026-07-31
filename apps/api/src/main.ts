import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<void> {
  // `rawBody: true` preserves the exact request bytes on `req.rawBody`
  // alongside the normally-parsed `req.body` for every route — needed only
  // by MotorEventAuthGuard (POST /integration/events) to verify an HMAC
  // signature computed over the untouched body; every other route is
  // unaffected, since `req.body` still gets parsed exactly as before.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Serves whatever LocalImageStorageAdapter writes (STORAGE_DRIVER=local,
  // the dev default) back out at /uploads/<organizationId>/<file> — see
  // its class comment for why this must be a public, unauthenticated URL.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Required for OnModuleDestroy (DatabaseService pool.end()) to actually
  // run on SIGTERM/SIGINT, instead of the connection pool being abandoned
  // when the process exits (e.g. during a deploy or container restart).
  app.enableShutdownHooks();

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Outreach Platform API')
    .setDescription('Panel administrativo y plano de control de la plataforma de prospección.')
    .setVersion('0.1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port} (docs at /docs)`);
}

bootstrap();
