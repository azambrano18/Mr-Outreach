import { INestApplication } from '@nestjs/common';
import request from 'supertest';

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
