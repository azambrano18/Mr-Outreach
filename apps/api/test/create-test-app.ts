import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

/**
 * e2e specs must boot the app the same way main.ts does — otherwise DTO
 * validation (class-validator decorators) silently never runs, and a test
 * asserting a 400 for bad input is actually exercising an app with no
 * validation pipe at all. Mirrors main.ts's bootstrap() minus the parts
 * that only matter for a real listening process (CORS, Swagger, port).
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
