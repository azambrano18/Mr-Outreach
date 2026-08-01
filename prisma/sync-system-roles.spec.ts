import { ADMIN_PERMISSION_KEYS, EXECUTIVE_PERMISSION_KEYS, PERMISSION_CATALOG } from '../apps/api/src/modules/seed/permission-catalog';
import { ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME } from '../apps/api/src/modules/seed/system-roles';
import { diagnose, loadConfig, requireConfirmation, runApply, runCheck, SyncConfig } from './sync-system-roles';
import { FakeOrganization, FakePrismaClient, FakeRole } from './test-support/fake-prisma-client';

const VALID_ENV = {
  SYNC_ROLES_TARGET: 'staging',
  SYNC_ROLES_DATABASE_BRANCH: 'staging',
  SYNC_ROLES_CONFIRM: 'SYNC_SYSTEM_ROLES_IN_STAGING',
  SYNC_ROLES_ORGANIZATION_NAME: 'MejoReferido',
} as const;

function setEnv(overrides: Partial<Record<keyof typeof VALID_ENV, string | undefined>> = {}): void {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function fixedConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return { target: 'staging', databaseBranch: 'staging', organizationName: 'MejoReferido', ...overrides };
}

const ORG: FakeOrganization = { id: 'org-1', name: 'MejoReferido', deletedAt: null };

describe('sync-system-roles', () => {
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

  it('accepts matching SYNC_ROLES_TARGET/SYNC_ROLES_DATABASE_BRANCH', () => {
    setEnv();
    expect(loadConfig().target).toBe('staging');
  });

  it('rejects a SYNC_ROLES_DATABASE_BRANCH that does not match SYNC_ROLES_TARGET', () => {
    setEnv({ SYNC_ROLES_DATABASE_BRANCH: 'production' });
    expect(() => loadConfig()).toThrow(/SYNC_ROLES_DATABASE_BRANCH/);
  });

  it('requires the exact confirmation SYNC_SYSTEM_ROLES_IN_STAGING', () => {
    setEnv();
    expect(() => requireConfirmation('staging')).not.toThrow();

    setEnv({ SYNC_ROLES_CONFIRM: 'SOMETHING_ELSE' });
    expect(() => requireConfirmation('staging')).toThrow(/SYNC_ROLES_CONFIRM/);

    setEnv({ SYNC_ROLES_CONFIRM: undefined });
    expect(() => requireConfirmation('staging')).toThrow(/SYNC_ROLES_CONFIRM/);
  });

  // ---------------------------------------------------------------------
  // --check never writes
  // ---------------------------------------------------------------------

  it('--check performs no write operations', async () => {
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runCheck(fake as any, fixedConfig());
    const writeCalls = fake.calls.filter((c) => /create|upsert|createMany/.test(c));
    expect(writeCalls).toHaveLength(0);
    expect(fake.store.roles).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // diagnose() outcomes
  // ---------------------------------------------------------------------

  it('blocks when the named organization does not exist — this script never creates one', async () => {
    const fake = new FakePrismaClient();
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/never creates organizations/);
  });

  it('blocks when the organization name is ambiguous', async () => {
    const fake = new FakePrismaClient({
      organizations: [ORG, { id: 'org-2', name: 'MejoReferido', deletedAt: null }],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/ambiguous/);
  });

  it('projects CREATE when the organization exists but neither system role does', async () => {
    const fake = new FakePrismaClient({ organizations: [ORG] });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('CREATE');
  });

  it('projects RECONCILE when both roles exist but are missing catalog permissions', async () => {
    const adminRole: FakeRole = { id: 'role-admin', organizationId: ORG.id, name: ADMIN_ROLE_NAME };
    const executiveRole: FakeRole = { id: 'role-exec', organizationId: ORG.id, name: EXECUTIVE_ROLE_NAME };
    const fake = new FakePrismaClient({ organizations: [ORG], roles: [adminRole, executiveRole] });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('RECONCILE');
  });

  it('projects NO_CHANGES when both roles already hold every catalog permission', async () => {
    const adminRole: FakeRole = { id: 'role-admin', organizationId: ORG.id, name: ADMIN_ROLE_NAME };
    const executiveRole: FakeRole = { id: 'role-exec', organizationId: ORG.id, name: EXECUTIVE_ROLE_NAME };
    const fake = new FakePrismaClient({
      organizations: [ORG],
      roles: [adminRole, executiveRole],
      permissions: PERMISSION_CATALOG.map((p) => ({ ...p })),
      rolePermissions: [
        ...ADMIN_PERMISSION_KEYS.map((permissionKey) => ({ roleId: adminRole.id, permissionKey })),
        ...EXECUTIVE_PERMISSION_KEYS.map((permissionKey) => ({ roleId: executiveRole.id, permissionKey })),
      ],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('NO_CHANGES');
  });

  // ---------------------------------------------------------------------
  // --apply: creation from an organization with only ADMIN configured
  // ---------------------------------------------------------------------

  it('creates the EXECUTIVE role when only ADMIN exists — this is exactly the staging bug this script fixes', async () => {
    setEnv();
    const adminRole: FakeRole = { id: 'role-admin', organizationId: ORG.id, name: ADMIN_ROLE_NAME };
    const fake = new FakePrismaClient({
      organizations: [ORG],
      roles: [adminRole],
      permissions: PERMISSION_CATALOG.map((p) => ({ ...p })),
      rolePermissions: ADMIN_PERMISSION_KEYS.map((permissionKey) => ({ roleId: adminRole.id, permissionKey })),
    });

    await runApply(fake as any, fixedConfig());

    const roleNames = fake.store.roles.map((r) => r.name).sort();
    expect(roleNames).toEqual([ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME].sort());
  });

  it('assigns exactly EXECUTIVE_PERMISSION_KEYS to EXECUTIVE, never ADMIN_PERMISSION_KEYS', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());

    const executiveRole = fake.store.roles.find((r) => r.name === EXECUTIVE_ROLE_NAME)!;
    const executiveKeys = fake.store.rolePermissions
      .filter((rp) => rp.roleId === executiveRole.id)
      .map((rp) => rp.permissionKey);
    expect(new Set(executiveKeys)).toEqual(new Set(EXECUTIVE_PERMISSION_KEYS));
  });

  it('assigns exactly ADMIN_PERMISSION_KEYS (the full catalog) to ADMIN', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());

    const adminRole = fake.store.roles.find((r) => r.name === ADMIN_ROLE_NAME)!;
    const adminKeys = fake.store.rolePermissions
      .filter((rp) => rp.roleId === adminRole.id)
      .map((rp) => rp.permissionKey);
    expect(new Set(adminKeys)).toEqual(new Set(ADMIN_PERMISSION_KEYS));
  });

  it('syncs the full permission catalog', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());
    expect(fake.store.permissions).toHaveLength(PERMISSION_CATALOG.length);
  });

  it('never creates a user', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());
    expect(fake.store.users).toHaveLength(0);
  });

  it('never creates another organization', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());
    expect(fake.store.organizations).toHaveLength(1);
    expect(fake.store.organizations[0].id).toBe(ORG.id);
  });

  it('never touches a pre-existing custom role', async () => {
    setEnv();
    const customRole: FakeRole = { id: 'role-custom', organizationId: ORG.id, name: 'AUDITOR_EXTERNO' };
    const fake = new FakePrismaClient({ organizations: [ORG], roles: [customRole] });
    await runApply(fake as any, fixedConfig());

    const preserved = fake.store.roles.find((r) => r.id === 'role-custom');
    expect(preserved).toEqual(customRole);
  });

  it('is idempotent — a second run creates no duplicate roles or duplicate role-permission rows', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());
    const rolesAfterFirst = fake.store.roles.length;
    const rolePermissionsAfterFirst = fake.store.rolePermissions.length;

    await runApply(fake as any, fixedConfig());

    expect(fake.store.roles).toHaveLength(rolesAfterFirst);
    expect(fake.store.rolePermissions).toHaveLength(rolePermissionsAfterFirst);
  });

  it('records an audit log entry with no credentials, since this script never handles any', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());
    expect(fake.store.auditLogs).toHaveLength(1);
    expect(fake.store.auditLogs[0].action).toBe('system_roles.sync');
    expect(fake.store.auditLogs[0].organizationId).toBe(ORG.id);
  });

  it('refuses to run against target=production regardless of confirmation', async () => {
    process.env.SYNC_ROLES_CONFIRM = 'SYNC_SYSTEM_ROLES_IN_PRODUCTION';
    const fake = new FakePrismaClient({ organizations: [{ ...ORG }] });
    await expect(runApply(fake as any, fixedConfig({ target: 'production' }))).rejects.toThrow(/production/i);
    expect(fake.store.roles).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Transaction / rollback / advisory lock
  // ---------------------------------------------------------------------

  it('acquires the advisory lock as the very first operation inside the transaction', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    await runApply(fake as any, fixedConfig());
    expect(fake.calls[0]).toBe('$queryRaw:advisory_lock');
  });

  it('aborts immediately with no writes when the advisory lock is unavailable', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    fake.lockAvailable = false;
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/holds the lock/);
    expect(fake.store.roles).toHaveLength(0);
  });

  it('rolls back every write if an operation fails mid-transaction', async () => {
    setEnv();
    const fake = new FakePrismaClient({ organizations: [ORG] });
    fake.failOnCall = 'auditLog.create';
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/Simulated failure/);
    expect(fake.store.roles).toHaveLength(0);
    expect(fake.store.rolePermissions).toHaveLength(0);
    expect(fake.store.permissions).toHaveLength(0);
  });
});
