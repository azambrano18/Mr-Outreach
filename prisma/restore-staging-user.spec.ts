import { diagnose, loadConfig, requireConfirmation, runApply, runCheck } from './restore-staging-user';
import { FakeOrganization, FakePrismaClient, FakeRole, FakeUser } from './test-support/fake-prisma-client';

const VALID_ENV = {
  RESTORE_USER_TARGET: 'staging',
  RESTORE_USER_DATABASE_BRANCH: 'staging',
  RESTORE_USER_ORGANIZATION_NAME: 'MejoReferido',
  RESTORE_USER_EMAIL: 'azambrano@mejoreferido.cl',
  RESTORE_USER_CONFIRM: 'RESTORE_DELETED_USER_IN_STAGING',
} as const;

function setEnv(overrides: Partial<Record<keyof typeof VALID_ENV, string | undefined>> = {}): void {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const ORG: FakeOrganization = { id: 'org-1', name: 'MejoReferido', deletedAt: null };
const EXECUTIVE_ROLE: FakeRole = { id: 'role-exec', organizationId: 'org-1', name: 'EXECUTIVE' };
const ADMIN_ROLE: FakeRole = { id: 'role-admin', organizationId: 'org-1', name: 'ADMIN' };

const DELETED_AT = new Date('2026-08-03T18:28:52.180Z');

const DELETED_USER: FakeUser = {
  id: 'user-1',
  organizationId: 'org-1',
  firstName: 'Alejandro',
  lastName: 'Zambrano',
  email: 'azambrano@mejoreferido.cl',
  passwordHash: 'old-hash',
  status: 'INACTIVE',
  mustChangePassword: false,
  deletedAt: DELETED_AT,
  lastLoginAt: new Date('2026-07-01T00:00:00.000Z'),
  passwordChangedAt: new Date('2026-06-01T00:00:00.000Z'),
};

function baseFixture(overrides: Partial<FakeUser> = {}) {
  const fake = new FakePrismaClient({
    organizations: [ORG],
    roles: [EXECUTIVE_ROLE, ADMIN_ROLE],
    users: [{ ...DELETED_USER, ...overrides }],
    userRoles: [{ userId: 'user-1', roleId: ADMIN_ROLE.id }],
  });
  return fake;
}

function fixedConfig() {
  return { target: 'staging', databaseBranch: 'staging', organizationName: 'MejoReferido', email: 'azambrano@mejoreferido.cl' };
}

describe('restore-staging-user', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('accepts matching TARGET/DATABASE_BRANCH', () => {
    setEnv();
    expect(loadConfig().target).toBe('staging');
    expect(loadConfig().email).toBe('azambrano@mejoreferido.cl');
  });

  it('normalizes the email (trim/lowercase)', () => {
    setEnv({ RESTORE_USER_EMAIL: '  Azambrano@MejoReferido.CL  ' });
    expect(loadConfig().email).toBe('azambrano@mejoreferido.cl');
  });

  it('rejects a DATABASE_BRANCH that does not match TARGET', () => {
    setEnv({ RESTORE_USER_DATABASE_BRANCH: 'production' });
    expect(() => loadConfig()).toThrow(/DATABASE_BRANCH/);
  });

  it('requires the exact confirmation phrase for --apply', () => {
    setEnv();
    expect(() => requireConfirmation('staging')).not.toThrow();
    setEnv({ RESTORE_USER_CONFIRM: 'WRONG' });
    expect(() => requireConfirmation('staging')).toThrow(/RESTORE_USER_CONFIRM/);
    setEnv({ RESTORE_USER_CONFIRM: undefined });
    expect(() => requireConfirmation('staging')).toThrow(/RESTORE_USER_CONFIRM/);
  });

  describe('diagnose', () => {
    it('detects the deleted user, in the right organization, with the EXECUTIVE role available, and reports READY', async () => {
      const fake = baseFixture();
      const diagnosis = await diagnose(fake as any, fixedConfig());

      expect(diagnosis.result).toBe('READY');
      expect(diagnosis.organizationId).toBe('org-1');
      expect(diagnosis.userId).toBe('user-1');
      expect(diagnosis.normalizedEmail).toBe('azambrano@mejoreferido.cl');
      expect(diagnosis.deletedAt).toEqual(DELETED_AT);
      expect(diagnosis.currentRoleName).toBe('ADMIN');
      expect(diagnosis.executiveRoleId).toBe(EXECUTIVE_ROLE.id);
    });

    it('blocks when the user does not exist', async () => {
      const fake = new FakePrismaClient({ organizations: [ORG], roles: [EXECUTIVE_ROLE] });
      const diagnosis = await diagnose(fake as any, fixedConfig());
      expect(diagnosis.result).toBe('BLOCKED');
      expect(diagnosis.reasons.join(' ')).toMatch(/No user with email/);
    });

    it('blocks when the user belongs to a different organization', async () => {
      const fake = baseFixture({ organizationId: 'org-2' });
      const diagnosis = await diagnose(fake as any, fixedConfig());
      expect(diagnosis.result).toBe('BLOCKED');
      expect(diagnosis.reasons.join(' ')).toMatch(/not in organization/);
    });

    it('blocks when the EXECUTIVE role does not exist in this organization', async () => {
      const fake = new FakePrismaClient({
        organizations: [ORG],
        roles: [ADMIN_ROLE],
        users: [DELETED_USER],
        userRoles: [{ userId: 'user-1', roleId: ADMIN_ROLE.id }],
      });
      const diagnosis = await diagnose(fake as any, fixedConfig());
      expect(diagnosis.result).toBe('BLOCKED');
      expect(diagnosis.reasons.join(' ')).toMatch(/EXECUTIVE role does not exist/);
    });

    it('blocks when the organization does not exist', async () => {
      const fake = new FakePrismaClient();
      const diagnosis = await diagnose(fake as any, fixedConfig());
      expect(diagnosis.result).toBe('BLOCKED');
      expect(diagnosis.reasons.join(' ')).toMatch(/No organization named/);
    });

    it('unconditionally blocks the protected system account, sistema@mejoreferido.cl', async () => {
      const fake = baseFixture();
      const diagnosis = await diagnose(fake as any, { ...fixedConfig(), email: 'sistema@mejoreferido.cl' });
      expect(diagnosis.result).toBe('BLOCKED');
      expect(diagnosis.reasons.join(' ')).toMatch(/protected system account/);
    });

    it('reports ALREADY_ACTIVE (not READY, not BLOCKED-as-error) when the user is not currently deleted', async () => {
      const fake = baseFixture({ deletedAt: null, status: 'ACTIVE' });
      const diagnosis = await diagnose(fake as any, fixedConfig());
      expect(diagnosis.result).toBe('ALREADY_ACTIVE');
    });

    it('reports existing operational relations without restoring them', async () => {
      const fake = baseFixture();
      fake.store.mailboxAssignments.push({ id: 'ma1', organizationId: 'org-1', mailboxId: 'mbx1', userId: 'user-1', role: 'SECONDARY' });
      fake.store.clientExecutiveAssignments.push({ id: 'ca1', organizationId: 'org-1', clientId: 'client-1', userId: 'user-1' });
      const diagnosis = await diagnose(fake as any, fixedConfig());
      expect(diagnosis.relations.secondaryMailboxCount).toBe(1);
      expect(diagnosis.relations.clientAssignmentCount).toBe(1);
    });
  });

  describe('--check', () => {
    it('is entirely read-only', async () => {
      setEnv();
      const fake = baseFixture();
      await runCheck(fake as any, fixedConfig());
      const writeCalls = fake.calls.filter((c) => /update|create|deleteMany/.test(c));
      expect(writeCalls).toHaveLength(0);
      expect(fake.store.users[0].deletedAt).toEqual(DELETED_AT);
    });
  });

  describe('--apply', () => {
    it('restores the same userId: clears deletedAt, sets ACTIVE, assigns EXECUTIVE, generates a new password, forces mustChangePassword, clears passwordChangedAt, and audits user.restored', async () => {
      setEnv();
      const fake = baseFixture();

      const result = await runApply(fake as any, fixedConfig());

      const restoredUser = fake.store.users.find((u) => u.id === 'user-1')!;
      expect(restoredUser.id).toBe('user-1');
      expect(restoredUser.deletedAt).toBeNull();
      expect(restoredUser.status).toBe('ACTIVE');
      expect(restoredUser.mustChangePassword).toBe(true);
      expect(restoredUser.passwordChangedAt).toBeNull();
      expect(restoredUser.passwordHash).not.toBe('old-hash');

      const roles = fake.store.userRoles.filter((ur) => ur.userId === 'user-1');
      expect(roles).toHaveLength(1);
      expect(roles[0].roleId).toBe(EXECUTIVE_ROLE.id);

      expect(result.temporaryPassword).toEqual(expect.any(String));
      expect(result.temporaryPassword!.length).toBeGreaterThanOrEqual(12);

      const restoreAudits = fake.store.auditLogs.filter((a) => a.action === 'user.restored');
      expect(restoreAudits).toHaveLength(1);
      expect(JSON.stringify(restoreAudits[0])).not.toContain(result.temporaryPassword);
    });

    it('never restores mailbox or client assignments — the user comes back with zero operational relations attached by this script', async () => {
      setEnv();
      const fake = baseFixture();
      fake.store.mailboxAssignments.push({ id: 'ma1', organizationId: 'org-1', mailboxId: 'mbx1', userId: 'user-1', role: 'SECONDARY' });
      fake.store.clientExecutiveAssignments.push({ id: 'ca1', organizationId: 'org-1', clientId: 'client-1', userId: 'user-1' });

      await runApply(fake as any, fixedConfig());

      // Mailbox assignments are untouched by this script (structurally
      // impossible to exist post-deletion in practice; left alone here too).
      expect(fake.store.mailboxAssignments).toHaveLength(1);
      // Client assignments ARE explicitly cleared.
      expect(fake.store.clientExecutiveAssignments).toHaveLength(0);
    });

    it('is idempotent — a second --apply reports ALREADY_ACTIVE, generates no new password, and does not duplicate the audit', async () => {
      setEnv();
      const fake = baseFixture();

      const first = await runApply(fake as any, fixedConfig());
      const second = await runApply(fake as any, fixedConfig());

      expect(first.temporaryPassword).not.toBeNull();
      expect(second.temporaryPassword).toBeNull();
      expect(second.diagnosis.result).toBe('ALREADY_ACTIVE');

      const restoreAudits = fake.store.auditLogs.filter((a) => a.action === 'user.restored');
      expect(restoreAudits).toHaveLength(1);
    });

    it('refuses to run against production, unconditionally', async () => {
      setEnv({
        RESTORE_USER_TARGET: 'production',
        RESTORE_USER_DATABASE_BRANCH: 'production',
        RESTORE_USER_CONFIRM: 'RESTORE_DELETED_USER_IN_PRODUCTION',
      });
      const fake = baseFixture();
      await expect(
        runApply(fake as any, { ...fixedConfig(), target: 'production', databaseBranch: 'production' }),
      ).rejects.toThrow(/refuses to run against/);
      expect(fake.store.users[0].deletedAt).toEqual(DELETED_AT);
    });

    it('blocks restoring a user that belongs to a different organization', async () => {
      setEnv();
      const fake = baseFixture({ organizationId: 'org-2' });
      await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/Blocked/);
      expect(fake.store.users[0].deletedAt).toEqual(DELETED_AT);
    });

    it('unconditionally protects sistema@mejoreferido.cl, even with a valid confirmation phrase', async () => {
      setEnv({ RESTORE_USER_EMAIL: 'sistema@mejoreferido.cl', RESTORE_USER_CONFIRM: 'RESTORE_DELETED_USER_IN_STAGING' });
      const fake = baseFixture({ email: 'sistema@mejoreferido.cl' });
      await expect(
        runApply(fake as any, { ...fixedConfig(), email: 'sistema@mejoreferido.cl' }),
      ).rejects.toThrow(/Blocked/);
    });

    it('requires the confirmation phrase before writing anything', async () => {
      setEnv({ RESTORE_USER_CONFIRM: undefined });
      const fake = baseFixture();
      await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/RESTORE_USER_CONFIRM/);
      expect(fake.store.users[0].deletedAt).toEqual(DELETED_AT);
    });

    it('rolls back entirely if the advisory lock is unavailable', async () => {
      setEnv();
      const fake = baseFixture();
      fake.lockAvailable = false;
      await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/lock/);
      expect(fake.store.users[0].deletedAt).toEqual(DELETED_AT);
    });

    it('never creates a second row with the same email — reuses the same userId, store still has exactly one user', async () => {
      setEnv();
      const fake = baseFixture();
      await runApply(fake as any, fixedConfig());
      expect(fake.store.users).toHaveLength(1);
      expect(fake.store.users[0].id).toBe('user-1');
    });
  });
});
