import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

// Only the magic-byte header matters to sniffImageType — the rest of a
// real PNG (IHDR/IDAT/IEND chunks) is irrelevant to what this endpoint
// validates, so a short buffer with the right signature is enough here.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('Uploads (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const executiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });
    executiveToken = executiveLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('uploads a valid PNG and returns a publicly-reachable URL', async () => {
    const response = await request(app.getHttpServer())
      .post('/uploads/images')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG_HEADER, 'logo.png');

    expect(response.status).toBe(201);
    expect(response.body.url).toMatch(/^http:\/\/.*\/uploads\/.+\.png$/);
  });

  it('rejects a renamed non-image file even with a .png extension', async () => {
    const response = await request(app.getHttpServer())
      .post('/uploads/images')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('<html>not an image</html>'), 'fake.png');

    expect(response.status).toBe(400);
  });

  it('rejects the request when no file is attached', async () => {
    const response = await request(app.getHttpServer())
      .post('/uploads/images')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app.getHttpServer())
      .post('/uploads/images')
      .attach('file', PNG_HEADER, 'logo.png');

    expect(response.status).toBe(401);
  });

  it('an executive with signatures.update (self-service firma editing) can upload', async () => {
    const response = await request(app.getHttpServer())
      .post('/uploads/images')
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', PNG_HEADER, 'logo.png');

    expect(response.status).toBe(201);
    expect(response.body.url).toMatch(/^http:\/\/.*\/uploads\/.+\.png$/);
  });
});
