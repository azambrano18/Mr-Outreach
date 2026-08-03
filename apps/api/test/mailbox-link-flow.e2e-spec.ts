import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { ConversationRepository } from '../src/domain/conversation/conversation.repository';
import { CONVERSATION_REPOSITORY } from '../src/infrastructure/persistence/tokens';
import { SimulatedMailboxMotorAdapter } from '../src/infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';

/** Fase 2 (R2) — a real, valid single-color PNG (correct IHDR width/height), so getImageDimensions() can parse it — not just magic-byte-recognizable. */
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

/**
 * Fase 2.1 (e2e) — the 5 admin-facing HTTP endpoints for token-based
 * mailbox linking: link-token/introspect, link, :id/primary-executive,
 * :id/refresh-status, :id/unlink(+/retry). Memory persistence + the
 * simulated motor adapter only — no real Postgres/Railway.
 */
describe('Mailbox link flow (e2e) — memory + simulated motor', () => {
  let app: INestApplication;
  let motor: SimulatedMailboxMotorAdapter;
  let adminToken: string;
  let executiveToken: string;
  let executiveId: string;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();
    motor = app.get(SimulatedMailboxMotorAdapter);

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const executiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });
    executiveToken = executiveLogin.body.accessToken;

    const executiveMe = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${executiveToken}`);
    executiveId = executiveMe.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function issueToken(overrides: Partial<Parameters<SimulatedMailboxMotorAdapter['issueLinkToken']>[0]> = {}) {
    const suffix = `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
    return motor.issueLinkToken({
      email: `ventas@e2e-${suffix}.test`,
      displayName: 'Ventas',
      domainName: `e2e-${suffix}.test`,
      clientName: 'Cliente E2E',
      ...overrides,
    });
  }

  describe('POST /mailboxes/link-token/introspect', () => {
    it('returns mailbox/domain/client info for a valid token, without the token echoed back', async () => {
      const token = issueToken();

      const response = await request(app.getHttpServer())
        .post('/mailboxes/link-token/introspect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token });

      expect(response.status).toBe(201);
      expect(response.body.valid).toBe(true);
      expect(response.body.mailbox.email).toContain('ventas@e2e-');
      expect(JSON.stringify(response.body)).not.toContain(token);
    });

    it('returns valid:false with status EXPIRED for a recognized but expired token — never throws', async () => {
      const token = issueToken({ scenario: 'EXPIRED' });

      const response = await request(app.getHttpServer())
        .post('/mailboxes/link-token/introspect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token });

      expect(response.status).toBe(201);
      expect(response.body.valid).toBe(false);
      expect(response.body.status).toBe('EXPIRED');
    });

    it('400s for an unrecognized/malformed token', async () => {
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link-token/introspect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token: 'not-a-real-token' });

      expect(response.status).toBe(400);
    });

    it('rejects a user without mailboxes.link (executive)', async () => {
      const token = issueToken();

      const response = await request(app.getHttpServer())
        .post('/mailboxes/link-token/introspect')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ token });

      expect(response.status).toBe(403);
    });

  });

  describe('POST /mailboxes/link', () => {
    it('requires the Idempotency-Key header', async () => {
      const token = issueToken();
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token, primaryExecutiveId: executiveId });

      expect(response.status).toBe(400);
    });

    it('links a mailbox, creating client/domain/mailbox/assignment, and never echoes the token', async () => {
      const token = issueToken();
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-link-${stamp}-1`)
        .send({ token, primaryExecutiveId: executiveId });

      expect(response.status).toBe(201);
      expect(response.body.mailboxId).toBeDefined();
      expect(response.body.linkStatus).toBe('ACTIVE');
      expect(JSON.stringify(response.body)).not.toContain(token);

      const getResponse = await request(app.getHttpServer())
        .get(`/mailboxes/${response.body.mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.status).toBe(200);
      expect(getResponse.body.linkSource).toBe('SERVER_TOKEN');
      // §"cliente y dominio como información de solo lectura en cada cuenta" — the detail
      // endpoint resolves them from the token's own snapshot, never a live client/domain fetch.
      expect(getResponse.body.clientName).toBe('Cliente E2E');
      expect(getResponse.body.domainName).toContain('e2e-');
    });

    it('returns the identical result on a retry with the same Idempotency-Key, never creating a second mailbox', async () => {
      const token = issueToken();
      const key = `e2e-link-${stamp}-2`;
      const body = { token, primaryExecutiveId: executiveId };

      const first = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
    });

    it('rejects an empty primaryExecutiveId (required field)', async () => {
      const token = issueToken();
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-link-${stamp}-3`)
        .send({ token, primaryExecutiveId: '' });

      expect(response.status).toBe(400);
    });

    it('an executive without mailboxes.link cannot link an account', async () => {
      const token = issueToken();
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `e2e-link-${stamp}-4`)
        .send({ token, primaryExecutiveId: executiveId });

      expect(response.status).toBe(403);
    });

    it('410s for an expired token', async () => {
      const token = issueToken({ scenario: 'EXPIRED' });
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-link-${stamp}-5`)
        .send({ token, primaryExecutiveId: executiveId });

      expect(response.status).toBe(410);
    });
  });

  describe('PATCH /mailboxes/:id/primary-executive', () => {
    async function linkMailbox(suffix: string): Promise<string> {
      const token = issueToken();
      const response = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-reassign-setup-${stamp}-${suffix}`)
        .send({ token, primaryExecutiveId: executiveId });
      return response.body.mailboxId;
    }

    it('reassigns the primary executive without a new token', async () => {
      const mailboxId = await linkMailbox('a');

      const response = await request(app.getHttpServer())
        .patch(`/mailboxes/${mailboxId}/primary-executive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-reassign-${stamp}-1`)
        .send({ newPrimaryExecutiveId: executiveId });

      expect(response.status).toBe(200);
      expect(response.body.newPrimaryExecutiveId).toBe(executiveId);
    });

    it('an executive without mailboxes.assign cannot reassign', async () => {
      const mailboxId = await linkMailbox('b');

      const response = await request(app.getHttpServer())
        .patch(`/mailboxes/${mailboxId}/primary-executive`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `e2e-reassign-${stamp}-2`)
        .send({ newPrimaryExecutiveId: executiveId });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /mailboxes/:id/refresh-status', () => {
    it('queries the (simulated) motor and updates the local snapshot', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-refresh-setup-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });
      const mailboxId = linkResponse.body.mailboxId;
      motor.setMailboxTechnicalStatus(linkResponse.body.serverMailboxId, 'DEGRADED', false);

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/refresh-status`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(201);
      expect(response.body.linkStatus).toBe('ACTIVE');

      const getResponse = await request(app.getHttpServer())
        .get(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.body.serverStatusSnapshot).toBe('DEGRADED');
      expect(getResponse.body.serverCanSendSnapshot).toBe(false);
    });

    it('an executive without mailboxes.refresh_status cannot refresh', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-refresh-setup2-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${linkResponse.body.mailboxId}/refresh-status`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /mailboxes/:id/unlink and /unlink/retry', () => {
    it('unlinks a mailbox: blocks local usage, never deletes it server-side, and is idempotent', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-setup-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });
      const mailboxId = linkResponse.body.mailboxId;

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-${stamp}-1`)
        .send({ reason: 'Cuenta dada de baja en e2e' });

      expect(response.status).toBe(201);
      expect(response.body.linkStatus).toBe('REVOKED');

      const second = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-${stamp}-2`)
        .send({ reason: 'Segundo intento' });
      expect(second.status).toBe(201);
      expect(second.body.linkStatus).toBe('REVOKED');

      const getResponse = await request(app.getHttpServer())
        .get(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.body.linkStatus).toBe('REVOKED');
    });

    it('hides a mailbox\'s conversations everywhere once it is unlinked (REVOKED) — list and direct fetch both stop returning them', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-hides-conversations-setup-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });
      const mailboxId = linkResponse.body.mailboxId;

      const adminMe = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      const conversations = app.get<ConversationRepository>(CONVERSATION_REPOSITORY);
      const conversation = await conversations.create({
        organizationId: adminMe.body.organizationId,
        clientId: linkResponse.body.clientId,
        domainId: linkResponse.body.domainId,
        mailboxId,
        emailThreadId: `thread-${stamp}`,
        contactEmail: 'prospecto@example.com',
        contactName: 'Prospecto E2E',
        origin: 'EXTERNAL_INBOUND',
        subject: 'Interesado',
        isUnread: true,
        lastMessageAt: new Date(),
      });

      const beforeUnlink = await request(app.getHttpServer())
        .get('/conversations')
        .query({ mailboxId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(beforeUnlink.body.map((c: { id: string }) => c.id)).toContain(conversation.id);

      const beforeUnlinkDirect = await request(app.getHttpServer())
        .get(`/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(beforeUnlinkDirect.status).toBe(200);

      const unlink = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-hides-conversations-${stamp}`)
        .send({ reason: 'Cuenta dada de baja en e2e' });
      expect(unlink.body.linkStatus).toBe('REVOKED');

      const afterUnlink = await request(app.getHttpServer())
        .get('/conversations')
        .query({ mailboxId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(afterUnlink.body.map((c: { id: string }) => c.id)).not.toContain(conversation.id);

      const afterUnlinkDirect = await request(app.getHttpServer())
        .get(`/conversations/${conversation.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(afterUnlinkDirect.status).toBe(404);
    });

    it('requires a non-empty reason', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-setup2-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${linkResponse.body.mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-${stamp}-3`)
        .send({ reason: '' });

      expect(response.status).toBe(400);
    });

    it('retries a stuck UNLINK_REQUESTED confirmation via /unlink/retry once the motor recovers', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-retry-setup-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });
      const mailboxId = linkResponse.body.mailboxId;
      const serverMailboxId = linkResponse.body.serverMailboxId;

      motor.setUnlinkOutcome(serverMailboxId, 'FAILURE');
      const firstAttempt = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-retry-${stamp}-1`)
        .send({ reason: 'Primer intento, motor caído' });
      expect(firstAttempt.body.linkStatus).toBe('UNLINK_REQUESTED');

      motor.setUnlinkOutcome(serverMailboxId, 'SUCCESS');
      const retry = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink/retry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(retry.status).toBe(201);
      expect(retry.body.linkStatus).toBe('REVOKED');
    });

    it('an executive without mailboxes.unlink cannot unlink', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-unlink-setup3-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${linkResponse.body.mailboxId}/unlink`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `e2e-unlink-${stamp}-4`)
        .send({ reason: 'no autorizado' });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /mailboxes/:id (§8.2 — only once unlinked)', () => {
    it('rejects deleting a mailbox that is still linked', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-delete-still-linked-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });

      const response = await request(app.getHttpServer())
        .delete(`/mailboxes/${linkResponse.body.mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(409);
    });

    it('deletes a mailbox once unlinked: it disappears from the overview and 404s directly', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-delete-setup-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });
      const mailboxId = linkResponse.body.mailboxId;

      await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-delete-unlink-${stamp}`)
        .send({ reason: 'Cuenta dada de baja en e2e' });

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteResponse.status).toBe(204);

      const getResponse = await request(app.getHttpServer())
        .get(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.status).toBe(404);

      const overview = await request(app.getHttpServer())
        .get('/mailboxes/overview')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(overview.body.map((item: { id: string }) => item.id)).not.toContain(mailboxId);
    });

    it('a second delete of the same (already-deleted) mailbox returns a controlled 404', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-delete-twice-setup-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });
      const mailboxId = linkResponse.body.mailboxId;

      await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-delete-twice-unlink-${stamp}`)
        .send({ reason: 'Cuenta dada de baja en e2e' });

      await request(app.getHttpServer()).delete(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);
      const secondDelete = await request(app.getHttpServer())
        .delete(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(secondDelete.status).toBe(404);
    });

    it('an executive without mailboxes.delete cannot delete a mailbox', async () => {
      const token = issueToken();
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-delete-forbidden-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });

      const response = await request(app.getHttpServer())
        .delete(`/mailboxes/${linkResponse.body.mailboxId}`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Fase 2 (R2) — signature-asset upload + mailbox deletion purges firmas/{correo}/ only', () => {
    async function linkUnlinkableMailbox(email: string, idempotencySuffix: string) {
      const token = issueToken({ email });
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-r2-link-${idempotencySuffix}`)
        .send({ token, primaryExecutiveId: executiveId });
      return linkResponse.body.mailboxId as string;
    }

    async function unlinkMailbox(mailboxId: string, idempotencySuffix: string) {
      await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-r2-unlink-${idempotencySuffix}`)
        .send({ reason: 'Cuenta dada de baja en e2e (R2)' });
    }

    async function uploadSignatureAsset(mailboxId: string) {
      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature-assets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', validPng(240, 90), 'logo.png');
      expect(response.status).toBe(201);
      return response.body as { assetId: string; publicUrl: string };
    }

    it('uploads a signature image keyed under firmas/{correo-normalizado}/ and the file exists on disk (simulated adapter)', async () => {
      const email = `firma-e2e-${stamp}-a@e2e.test`;
      const mailboxId = await linkUnlinkableMailbox(email, `${stamp}-a`);

      const asset = await uploadSignatureAsset(mailboxId);

      expect(asset.publicUrl).toContain(`firmas/${email}/`);
      const objectKey = `firmas/${email}/${asset.assetId}.png`;
      expect(existsSync(join(process.cwd(), 'uploads', objectKey))).toBe(true);
    });

    it('saves a signature made of only an uploaded image, with no text and no minimum character count enforced', async () => {
      const email = `firma-e2e-${stamp}-imgonly@e2e.test`;
      const mailboxId = await linkUnlinkableMailbox(email, `${stamp}-imgonly`);
      const asset = await uploadSignatureAsset(mailboxId);
      const imageOnlyHtml = `<img src="${asset.publicUrl}" alt="">`;

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ htmlContent: imageOnlyHtml });

      expect(response.status).toBe(201);
      expect(response.body.activeVersion.htmlContent).toContain('<img');
      expect(response.body.activeVersion.htmlContent).toContain(asset.assetId);

      const getResponse = await request(app.getHttpServer())
        .get(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.body.activeVersion.htmlContent).toContain('<img');
    });

    it('rejects a genuinely empty signature with a controlled 400 mentioning text or image, never a minimum-character message', async () => {
      const email = `firma-e2e-${stamp}-empty@e2e.test`;
      const mailboxId = await linkUnlinkableMailbox(email, `${stamp}-empty`);

      for (const emptyHtml of ['', '   ', '<p></p>', '<p><br></p>']) {
        const response = await request(app.getHttpServer())
          .post(`/mailboxes/${mailboxId}/signature`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ htmlContent: emptyHtml });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('La firma debe contener texto o al menos una imagen válida.');
      }
    });

    it('deleting the mailbox purges its entire firmas/{correo}/ folder, but leaves a different mailbox\'s folder untouched', async () => {
      const emailToDelete = `firma-e2e-${stamp}-b@e2e.test`;
      const emailToKeep = `firma-e2e-${stamp}-c@e2e.test`;
      const mailboxToDelete = await linkUnlinkableMailbox(emailToDelete, `${stamp}-b`);
      const mailboxToKeep = await linkUnlinkableMailbox(emailToKeep, `${stamp}-c`);

      const assetToDelete = await uploadSignatureAsset(mailboxToDelete);
      const assetToKeep = await uploadSignatureAsset(mailboxToKeep);
      const keyToDelete = `firmas/${emailToDelete}/${assetToDelete.assetId}.png`;
      const keyToKeep = `firmas/${emailToKeep}/${assetToKeep.assetId}.png`;
      expect(existsSync(join(process.cwd(), 'uploads', keyToDelete))).toBe(true);
      expect(existsSync(join(process.cwd(), 'uploads', keyToKeep))).toBe(true);

      await unlinkMailbox(mailboxToDelete, `${stamp}-b`);
      const deleteResponse = await request(app.getHttpServer())
        .delete(`/mailboxes/${mailboxToDelete}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteResponse.status).toBe(204);

      expect(existsSync(join(process.cwd(), 'uploads', keyToDelete))).toBe(false);
      // §21 — a sibling mailbox's folder must never be touched by another account's deletion.
      expect(existsSync(join(process.cwd(), 'uploads', keyToKeep))).toBe(true);
    });

    it('records mailbox.asset_cleanup_completed in the audit log after a successful deletion', async () => {
      const email = `firma-e2e-${stamp}-d@e2e.test`;
      const mailboxId = await linkUnlinkableMailbox(email, `${stamp}-d`);
      await uploadSignatureAsset(mailboxId);
      await unlinkMailbox(mailboxId, `${stamp}-d`);

      await request(app.getHttpServer()).delete(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);

      const auditResponse = await request(app.getHttpServer())
        .get(`/mailboxes/${mailboxId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const actions = auditResponse.body.map((entry: { action: string }) => entry.action);
      expect(actions).toContain('mailbox.delete');
      expect(actions).toContain('mailbox.asset_cleanup_completed');
    });

    it('POST /mailboxes/:id/retry-asset-cleanup is idempotent — retrying an already-COMPLETED cleanup succeeds without re-purging', async () => {
      const email = `firma-e2e-${stamp}-e@e2e.test`;
      const mailboxId = await linkUnlinkableMailbox(email, `${stamp}-e`);
      await unlinkMailbox(mailboxId, `${stamp}-e`);
      await request(app.getHttpServer()).delete(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);

      const retryResponse = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/retry-asset-cleanup`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(retryResponse.status).toBe(201);
      expect(retryResponse.body.assetCleanupStatus).toBe('COMPLETED');
    });

    it('an executive without mailboxes.delete cannot retry an asset cleanup', async () => {
      const email = `firma-e2e-${stamp}-f@e2e.test`;
      const mailboxId = await linkUnlinkableMailbox(email, `${stamp}-f`);
      await unlinkMailbox(mailboxId, `${stamp}-f`);
      await request(app.getHttpServer()).delete(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/retry-asset-cleanup`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /mailboxes/overview (§12.1 admin listing)', () => {
    it('includes linked mailboxes with denormalized client/domain/executive names', async () => {
      const token = issueToken({ clientName: 'Cliente Overview E2E' });
      const linkResponse = await request(app.getHttpServer())
        .post('/mailboxes/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-overview-${stamp}`)
        .send({ token, primaryExecutiveId: executiveId });

      const response = await request(app.getHttpServer())
        .get('/mailboxes/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const row = response.body.find((item: { id: string }) => item.id === linkResponse.body.mailboxId);
      expect(row).toBeDefined();
      expect(row.clientName).toBe('Cliente Overview E2E');
      expect(row.primaryExecutive.id).toBe(executiveId);
    });

    it('an executive without mailboxes.read.all cannot see the admin overview', async () => {
      const response = await request(app.getHttpServer())
        .get('/mailboxes/overview')
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /mailboxes/dev/demo-tokens (§5 — dev-only, simulated mode only)', () => {
    it('returns every required scenario, each usable against introspect, and never links the account itself', async () => {
      const response = await request(app.getHttpServer())
        .get('/mailboxes/dev/demo-tokens')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const keys = response.body.map((scenario: { key: string }) => scenario.key).sort();
      expect(keys).toEqual(['DISCONNECTED', 'EXPIRED', 'NO_SEND', 'REVOKED', 'USED', 'VALID'].sort());

      const valid = response.body.find((scenario: { key: string }) => scenario.key === 'VALID');
      expect(valid.client.name).toBe('Empresa Demostración');
      expect(valid.domain.name).toBe('empresademostracion.cl');
      expect(valid.mailbox.email).toBe('ventas@empresademostracion.cl');

      const introspect = await request(app.getHttpServer())
        .post('/mailboxes/link-token/introspect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token: valid.token });
      expect(introspect.body.valid).toBe(true);

      const used = response.body.find((scenario: { key: string }) => scenario.key === 'USED');
      const usedIntrospect = await request(app.getHttpServer())
        .post('/mailboxes/link-token/introspect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token: used.token });
      expect(usedIntrospect.body.status).toBe('REDEEMED');
    });

    it('an executive without mailboxes.link cannot fetch demo tokens', async () => {
      const response = await request(app.getHttpServer())
        .get('/mailboxes/dev/demo-tokens')
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });
  });

  // Last on purpose — exhausts this file's shared 60s/20-request throttle
  // budget for link-token/introspect; every other test above needs its own
  // successful introspect call and must run before this one.
  describe('rate limiting (§17 — must run last)', () => {
    it('rate-limits repeated introspection attempts (brute-force/enumeration protection)', async () => {
      const token = issueToken();
      const responses: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        const response = await request(app.getHttpServer())
          .post('/mailboxes/link-token/introspect')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ token });
        responses.push(response.status);
      }
      expect(responses).toContain(429);
    });
  });
});
