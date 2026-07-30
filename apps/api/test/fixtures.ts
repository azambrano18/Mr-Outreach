import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SimulatedMailboxMotorAdapter, IssueLinkTokenInput } from '../src/infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';
import { LinkMailboxResult } from '../src/application/mailboxes/link-mailbox.use-case';

export interface ReadyExecutive {
  id: string;
  email: string;
  token: string;
}

/** Any value satisfying AuthService's password policy (10+ chars, upper/lower/digit). */
const FIXTURE_PASSWORD = 'Fixture-Pass-1';

/**
 * Creates an executive via the admin-only POST /users (which no longer
 * accepts a password field — the server always generates a temporary one
 * and forces mustChangePassword), then immediately logs in with that
 * temporary password and changes it, so the returned token is usable right
 * away by every OTHER e2e spec that just needs a working executive fixture
 * — the forced-password-change flow itself has its own dedicated coverage
 * in users.e2e-spec.ts / auth-password.e2e-spec.ts.
 */
export async function createReadyExecutive(
  app: INestApplication,
  adminToken: string,
  input: { name: string; email: string; roleId: string },
): Promise<ReadyExecutive> {
  const [firstName, ...rest] = input.name.split(' ');
  const createRes = await request(app.getHttpServer())
    .post('/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ firstName, lastName: rest.join(' ') || 'Apellido', email: input.email, roleId: input.roleId });
  if (createRes.status !== 201) {
    throw new Error(
      `Failed to create fixture executive ${input.email}: ${createRes.status} ${JSON.stringify(createRes.body)}`,
    );
  }
  const { id, temporaryPassword } = createRes.body as { id: string; temporaryPassword: string };

  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: input.email, password: temporaryPassword });
  const token = loginRes.body.accessToken as string;

  await request(app.getHttpServer())
    .post('/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: temporaryPassword, newPassword: FIXTURE_PASSWORD });

  return { id, email: input.email, token };
}

/**
 * A `ManagedClient` (plus its Domain and a linked Mailbox) can no longer be
 * created via a manual "activate client" endpoint — the mailbox-link token
 * redemption (`POST /mailboxes/link`) is the only path. This fixture wraps
 * that flow: issues a simulated token via `SimulatedMailboxMotorAdapter`,
 * then redeems it as `adminToken`, returning the resulting ids.
 */
export async function linkClientMailbox(
  app: INestApplication,
  adminToken: string,
  primaryExecutiveId: string,
  overrides: Partial<IssueLinkTokenInput> = {},
): Promise<{ clientId: string; domainId: string; mailboxId: string; serverMailboxId: string }> {
  const motor = app.get(SimulatedMailboxMotorAdapter);
  const suffix = randomUUID().slice(0, 8);
  const token = motor.issueLinkToken({
    email: `ventas@fixture-${suffix}.test`,
    displayName: 'Ventas',
    domainName: `fixture-${suffix}.test`,
    clientName: 'Cliente Fixture',
    ...overrides,
  });

  const response = await request(app.getHttpServer())
    .post('/mailboxes/link')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', `fixture-link-${suffix}`)
    .send({ token, primaryExecutiveId });

  if (response.status !== 201) {
    throw new Error(`Failed to link fixture mailbox: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const result = response.body as LinkMailboxResult;
  return {
    clientId: result.clientId,
    domainId: result.domainId,
    mailboxId: result.mailboxId,
    serverMailboxId: result.serverMailboxId,
  };
}
