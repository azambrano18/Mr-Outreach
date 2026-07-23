import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Health (e2e) — memory + mock, no external services', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live always returns 200, even with no DATABASE_URL/ENGINE_BASE_URL configured', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'api' });
  });

  it('GET /health/ready reports the active memory/mock adapters as available, in development mode', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      mode: 'development',
      persistence: { driver: 'memory', status: 'available' },
      engine: { driver: 'mock', status: 'available' },
    });
  });
});
