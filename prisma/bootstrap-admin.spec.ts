import * as bcrypt from 'bcryptjs';
import {
  ADMIN_PERMISSION_KEYS,
  PERMISSION_CATALOG,
} from '../apps/api/src/modules/seed/permission-catalog';
import {
  ADMIN_ROLE_NAME,
  BootstrapConfig,
  PASSWORD_HASH_ROUNDS,
  REQUIRED_EMAIL_DOMAIN,
  diagnose,
  loadConfig,
  requireConfirmation,
  runApply,
  runCheck,
} from './bootstrap-admin';
import { FakePrismaClient, FakeOrganization, FakeRole, FakeUser } from './test-support/fake-prisma-client';

const VALID_EMAIL = `sistema${REQUIRED_EMAIL_DOMAIN}`;

const VALID_ENV = {
  BOOTSTRAP_TARGET: 'staging',
  BOOTSTRAP_DATABASE_BRANCH: 'staging',
  BOOTSTRAP_CONFIRM: 'CREATE_INITIAL_ADMIN_IN_STAGING',
  BOOTSTRAP_ORGANIZATION_NAME: 'MejoReferido',
  BOOTSTRAP_ADMIN_EMAIL: VALID_EMAIL,
  BOOTSTRAP_ADMIN_FIRST_NAME: 'Sistema',
  BOOTSTRAP_ADMIN_LAST_NAME: 'Bootstrap',
} as const;

function setEnv(overrides: Partial<Record<keyof typeof VALID_ENV, string | undefined>> = {}): void {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function fixedConfig(overrides: Partial<BootstrapConfig> = {}): BootstrapConfig {
  return {
    target: 'staging',
    databaseBranch: 'staging',
    organizationName: 'MejoReferido',
    adminEmail: VALID_EMAIL,
    adminFirstName: 'Sistema',
    adminLastName: 'Bootstrap',
    ...overrides,
  };
}

describe('bootstrap-admin', () => {
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

  // ---------------------------------------------------------------------
  // Env / config validation
  // ---------------------------------------------------------------------

  it('1. accepts BOOTSTRAP_TARGET=staging', () => {
    setEnv();
    expect(loadConfig().target).toBe('staging');
  });

  it('2. accepts BOOTSTRAP_DATABASE_BRANCH=staging', () => {
    setEnv();
    expect(loadConfig().databaseBranch).toBe('staging');
  });

  it('3. rejects BOOTSTRAP_DATABASE_BRANCH=production', () => {
    setEnv({ BOOTSTRAP_DATABASE_BRANCH: 'production' });
    expect(() => loadConfig()).toThrow(/BOOTSTRAP_DATABASE_BRANCH/);
  });

  it('4. rejects BOOTSTRAP_DATABASE_BRANCH=development', () => {
    setEnv({ BOOTSTRAP_DATABASE_BRANCH: 'development' });
    expect(() => loadConfig()).toThrow(/BOOTSTRAP_DATABASE_BRANCH/);
  });

  it('5. rejects BOOTSTRAP_DATABASE_BRANCH=test', () => {
    setEnv({ BOOTSTRAP_DATABASE_BRANCH: 'test' });
    expect(() => loadConfig()).toThrow(/BOOTSTRAP_DATABASE_BRANCH/);
  });

  it('6. requires the exact confirmation CREATE_INITIAL_ADMIN_IN_STAGING', () => {
    setEnv();
    expect(() => requireConfirmation('staging')).not.toThrow();

    setEnv({ BOOTSTRAP_CONFIRM: 'CREATE_INITIAL_ADMIN_IN_PRODUCTION' });
    expect(() => requireConfirmation('staging')).toThrow(/BOOTSTRAP_CONFIRM/);

    setEnv({ BOOTSTRAP_CONFIRM: undefined });
    expect(() => requireConfirmation('staging')).toThrow(/BOOTSTRAP_CONFIRM/);
  });

  it('7. accepts an email ending with the required domain (sistema@... today)', () => {
    setEnv({ BOOTSTRAP_ADMIN_EMAIL: VALID_EMAIL });
    expect(loadConfig().adminEmail).toBe(VALID_EMAIL);
  });

  it('8. rejects an email on an unauthorized domain', () => {
    setEnv({ BOOTSTRAP_ADMIN_EMAIL: 'sistema@unauthorized-domain.test' });
    expect(() => loadConfig()).toThrow(/must end with/);
  });

  it('9. normalizes the email to lowercase regardless of input casing', () => {
    const mixedCase = `SISTEMA${REQUIRED_EMAIL_DOMAIN.toUpperCase()}`;
    setEnv({ BOOTSTRAP_ADMIN_EMAIL: mixedCase });
    expect(loadConfig().adminEmail).toBe(mixedCase.toLowerCase());
  });

  // ---------------------------------------------------------------------
  // --check never writes
  // ---------------------------------------------------------------------

  it('10. --check performs no write operations', async () => {
    const fake = new FakePrismaClient();
    await runCheck(fake as any, fixedConfig());
    const writeCalls = fake.calls.filter((c) => /create|upsert|createMany/.test(c));
    expect(writeCalls).toHaveLength(0);
    expect(fake.store.organizations).toHaveLength(0);
    expect(fake.store.users).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // diagnose() outcomes
  // ---------------------------------------------------------------------

  it('11. projects CREATE when neither organization nor user exist', async () => {
    const fake = new FakePrismaClient();
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('CREATE');
  });

  it('12. projects RECONCILE when the user exists but lacks the role/permissions', async () => {
    const org: FakeOrganization = { id: 'org-1', name: 'MejoReferido', deletedAt: null };
    const user: FakeUser = {
      id: 'user-1',
      organizationId: org.id,
      firstName: 'Sistema',
      lastName: 'Bootstrap',
      email: VALID_EMAIL,
      passwordHash: 'irrelevant',
      status: 'ACTIVE',
      mustChangePassword: false,
      deletedAt: null,
    };
    const fake = new FakePrismaClient({ organizations: [org], users: [user] });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('RECONCILE');
  });

  it('13. projects NO_CHANGES when everything is already fully configured', async () => {
    const org: FakeOrganization = { id: 'org-1', name: 'MejoReferido', deletedAt: null };
    const user: FakeUser = {
      id: 'user-1',
      organizationId: org.id,
      firstName: 'Sistema',
      lastName: 'Bootstrap',
      email: VALID_EMAIL,
      passwordHash: 'irrelevant',
      status: 'ACTIVE',
      mustChangePassword: false,
      deletedAt: null,
    };
    const role: FakeRole = { id: 'role-1', organizationId: org.id, name: ADMIN_ROLE_NAME };
    const fake = new FakePrismaClient({
      organizations: [org],
      users: [user],
      roles: [role],
      rolePermissions: ADMIN_PERMISSION_KEYS.map((permissionKey) => ({ roleId: role.id, permissionKey })),
      userRoles: [{ userId: user.id, roleId: role.id }],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('NO_CHANGES');
  });

  it('14. projects BLOCKED when organizations are ambiguous', async () => {
    const fake = new FakePrismaClient({
      organizations: [
        { id: 'org-1', name: 'MejoReferido', deletedAt: null },
        { id: 'org-2', name: 'MejoReferido', deletedAt: null },
      ],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/ambiguous/);
  });

  it('15. blocks when the email already exists in a different organization', async () => {
    const targetOrg: FakeOrganization = { id: 'org-target', name: 'MejoReferido', deletedAt: null };
    const otherOrg: FakeOrganization = { id: 'org-other', name: 'OtraOrganizacion', deletedAt: null };
    const user: FakeUser = {
      id: 'user-1',
      organizationId: otherOrg.id,
      firstName: 'Sistema',
      lastName: 'Bootstrap',
      email: VALID_EMAIL,
      passwordHash: 'irrelevant',
      status: 'ACTIVE',
      mustChangePassword: false,
      deletedAt: null,
    };
    const fake = new FakePrismaClient({ organizations: [targetOrg, otherOrg], users: [user] });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/different organization/);
  });

  it('16. blocks when the user is INACTIVE', async () => {
    const org: FakeOrganization = { id: 'org-1', name: 'MejoReferido', deletedAt: null };
    const user: FakeUser = {
      id: 'user-1',
      organizationId: org.id,
      firstName: 'Sistema',
      lastName: 'Bootstrap',
      email: VALID_EMAIL,
      passwordHash: 'irrelevant',
      status: 'INACTIVE',
      mustChangePassword: false,
      deletedAt: null,
    };
    const fake = new FakePrismaClient({ organizations: [org], users: [user] });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/INACTIVE/);
  });

  it('17. blocks when the user has deletedAt set', async () => {
    const org: FakeOrganization = { id: 'org-1', name: 'MejoReferido', deletedAt: null };
    const user: FakeUser = {
      id: 'user-1',
      organizationId: org.id,
      firstName: 'Sistema',
      lastName: 'Bootstrap',
      email: VALID_EMAIL,
      passwordHash: 'irrelevant',
      status: 'ACTIVE',
      mustChangePassword: false,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const fake = new FakePrismaClient({ organizations: [org], users: [user] });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/soft-deleted/);
  });

  // ---------------------------------------------------------------------
  // --apply: creation from empty
  // ---------------------------------------------------------------------

  it('18. creates the ADMIN role', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    expect(fake.store.roles).toHaveLength(1);
    expect(fake.store.roles[0].name).toBe(ADMIN_ROLE_NAME);
  });

  it('19. synchronizes every permission from PERMISSION_CATALOG onto the ADMIN role', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    expect(fake.store.permissions).toHaveLength(PERMISSION_CATALOG.length);
    const roleId = fake.store.roles[0].id;
    const assignedKeys = fake.store.rolePermissions.filter((rp) => rp.roleId === roleId).map((rp) => rp.permissionKey);
    expect(new Set(assignedKeys)).toEqual(new Set(ADMIN_PERMISSION_KEYS));
  });

  it('20. assigns UserRole idempotently (no duplicate on a second run)', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    await runApply(fake as any, fixedConfig());
    expect(fake.store.userRoles).toHaveLength(1);
  });

  it('21. a second run creates no duplicate organization/user/role', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    await runApply(fake as any, fixedConfig());
    expect(fake.store.organizations).toHaveLength(1);
    expect(fake.store.users).toHaveLength(1);
    expect(fake.store.roles).toHaveLength(1);
  });

  it('22. a second run does not change the existing passwordHash', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    const hashAfterFirst = fake.store.users[0].passwordHash;
    await runApply(fake as any, fixedConfig());
    expect(fake.store.users[0].passwordHash).toBe(hashAfterFirst);
  });

  it('23. a second run does not generate another temporary password', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    const second = await runApply(fake as any, fixedConfig());
    expect(second.generatedPassword).toBeNull();
    expect(second.createdUser).toBe(false);
  });

  it('24. a new user is created with status=ACTIVE', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    expect(fake.store.users[0].status).toBe('ACTIVE');
  });

  it('25. a new user is created with mustChangePassword=true', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    expect(fake.store.users[0].mustChangePassword).toBe(true);
  });

  it('26. the stored hash is compatible with bcryptjs.compare against the returned temporary password', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    const result = await runApply(fake as any, fixedConfig());
    expect(result.generatedPassword).not.toBeNull();
    const matches = await bcrypt.compare(result.generatedPassword as string, fake.store.users[0].passwordHash);
    expect(matches).toBe(true);
    expect(fake.store.users[0].passwordHash).toMatch(new RegExp(`^\\$2[aby]\\$${PASSWORD_HASH_ROUNDS}\\$`));
  });

  it('27. the audit log never contains the password or the password hash', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    const result = await runApply(fake as any, fixedConfig());
    const serialized = JSON.stringify(fake.store.auditLogs);
    expect(serialized).not.toContain(result.generatedPassword as string);
    expect(serialized).not.toContain(fake.store.users[0].passwordHash);
  });

  // ---------------------------------------------------------------------
  // Transaction / rollback / advisory lock
  // ---------------------------------------------------------------------

  it('28. rolls back everything if an operation fails mid-transaction', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    fake.failOnCall = 'auditLog.create';
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/Simulated failure/);
    expect(fake.store.organizations).toHaveLength(0);
    expect(fake.store.users).toHaveLength(0);
    expect(fake.store.roles).toHaveLength(0);
    expect(fake.store.permissions).toHaveLength(0);
    expect(fake.store.rolePermissions).toHaveLength(0);
  });

  it('29. acquires the advisory lock as the very first operation inside the transaction', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    await runApply(fake as any, fixedConfig());
    expect(fake.calls[0]).toBe('$queryRaw:advisory_lock');
  });

  it('30. aborts immediately with no writes when the advisory lock is unavailable', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    fake.lockAvailable = false;
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/holds the lock/);
    expect(fake.calls).toEqual(['$queryRaw:advisory_lock']);
    expect(fake.store.organizations).toHaveLength(0);
  });

  it('31. the temporary password is only returned after a successful commit', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    const result = await runApply(fake as any, fixedConfig());
    // Reaching this point already proves $transaction resolved (committed)
    // before generatedPassword became observable to the caller.
    expect(result.generatedPassword).not.toBeNull();
    expect(fake.store.users).toHaveLength(1);
  });

  it('32. no result (and therefore no password) is ever returned if the transaction fails', async () => {
    setEnv();
    const fake = new FakePrismaClient();
    fake.failOnCall = 'user.create';
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow();
    // The promise rejected — there is no code path where a caller could
    // have received an ApplyResult / generatedPassword for this call.
    expect(fake.store.users).toHaveLength(0);
  });
});
