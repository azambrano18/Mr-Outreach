import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

/** A real, valid single-color PNG (correct IHDR width/height) — getImageDimensions() needs a parseable chunk, not just a magic-byte match. */
function validPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const chunkType = Buffer.from('IHDR', 'ascii');
  const widthBuf = Buffer.alloc(4);
  widthBuf.writeUInt32BE(width, 0);
  const heightBuf = Buffer.alloc(4);
  heightBuf.writeUInt32BE(height, 0);
  return Buffer.concat([signature, length, chunkType, widthBuf, heightBuf, Buffer.alloc(8)]);
}

describe('Email body assets (e2e) — Fase 2 (R2), §7/§10 — memory + simulated storage', () => {
  let app: INestApplication;
  let executiveToken: string;

  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });
    executiveToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('uploads a valid PNG under email-body/{organizationId}/{userId}/, never firmas/', async () => {
    const response = await request(app.getHttpServer())
      .post('/email-body-assets')
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', validPng(240, 90), 'diagram.png');

    expect(response.status).toBe(201);
    expect(response.body.publicUrl).toContain('/email-body/');
    expect(response.body.publicUrl).not.toContain('firmas/');
    expect(response.body.width).toBe(240);
    expect(response.body.height).toBe(90);
  });

  it('rejects a renamed non-image file (magic-byte validation, not filename)', async () => {
    const response = await request(app.getHttpServer())
      .post('/email-body-assets')
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', Buffer.from('<html>not an image</html>'), 'fake.png');

    expect(response.status).toBe(400);
  });

  it('rejects an image over the 2400x2400 dimension limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/email-body-assets')
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', validPng(2401, 100), 'wide.png');

    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app.getHttpServer()).post('/email-body-assets').attach('file', validPng(50, 50), 'x.png');
    expect(response.status).toBe(401);
  });

  it('deletes an unreferenced asset, and a second delete is idempotent', async () => {
    const upload = await request(app.getHttpServer())
      .post('/email-body-assets')
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', validPng(60, 60), 'unref.png');
    const assetId = upload.body.assetId as string;

    const firstDelete = await request(app.getHttpServer())
      .delete(`/email-body-assets/${assetId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(firstDelete.status).toBe(204);

    const secondDelete = await request(app.getHttpServer())
      .delete(`/email-body-assets/${assetId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(secondDelete.status).toBe(204);
  });

  it('404s deleting an asset id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .delete('/email-body-assets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(response.status).toBe(404);
  });
});
