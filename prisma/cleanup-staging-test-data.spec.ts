import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME } from '../apps/api/src/modules/seed/system-roles';
import {
  CleanupConfig,
  DESTRUCTIVE_NO_BACKUP_WARNING,
  diagnose,
  loadConfig,
  purgeAssets,
  requireConfirmation,
  requireDatabaseUrlPresent,
  requireExpectedOrganizationId,
  requirePhraseConfirmation,
  resolveBackupDecision,
  runApply,
  runCheck,
} from './cleanup-staging-test-data';
import { FakeCleanupPrismaClient, FakeRow } from './test-support/fake-cleanup-prisma-client';

const VALID_ENV = {
  STAGING_CLEANUP_TARGET: 'staging',
  STAGING_CLEANUP_DATABASE_BRANCH: 'staging',
  STAGING_CLEANUP_KEEP_ADMIN_EMAIL: 'sistema@mejoreferido.cl',
  STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL: 'azambrano@mejoreferido.cl',
  STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID: 'org-1',
  STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP: 'true',
  STAGING_CLEANUP_NO_BACKUP_PHRASE: 'ACEPTO ELIMINAR DEFINITIVAMENTE LOS DATOS DE STAGING SIN RESPALDO',
  STAGING_CLEANUP_CONFIRM: 'WIPE_TEST_DATA_IN_STAGING',
  STAGING_CLEANUP_CONFIRM_PHRASE: 'ELIMINAR DATOS DE PRUEBA STAGING',
} as const;

function setEnv(overrides: Partial<Record<keyof typeof VALID_ENV, string | undefined>> = {}): void {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Selects the "backup was created" path instead of the default "proceeding
// without backup" path used by VALID_ENV — mutually exclusive, so this
// clears the no-backup variables too.
function setEnvWithBackupAcknowledged(): void {
  setEnv({
    STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP: undefined,
    STAGING_CLEANUP_NO_BACKUP_PHRASE: undefined,
    STAGING_CLEANUP_BACKUP_ACKNOWLEDGED: 'true',
  } as any);
}

function fixedConfig(overrides: Partial<CleanupConfig> = {}): CleanupConfig {
  return {
    target: 'staging',
    databaseBranch: 'staging',
    keepAdminEmail: 'sistema@mejoreferido.cl',
    keepExecutiveEmail: 'azambrano@mejoreferido.cl',
    ...overrides,
  };
}

const ORG: FakeRow = { id: 'org-1', name: 'MejoReferido', deletedAt: null };
const ADMIN_ROLE: FakeRow = { id: 'role-admin', organizationId: 'org-1', name: ADMIN_ROLE_NAME };
const EXEC_ROLE: FakeRow = { id: 'role-exec', organizationId: 'org-1', name: EXECUTIVE_ROLE_NAME };
const ADMIN_USER: FakeRow = { id: 'user-admin', organizationId: 'org-1', email: 'sistema@mejoreferido.cl', status: 'ACTIVE', deletedAt: null };
const EXEC_USER: FakeRow = { id: 'user-exec', organizationId: 'org-1', email: 'azambrano@mejoreferido.cl', status: 'ACTIVE', deletedAt: null };
const BASE_USER_ROLES: FakeRow[] = [
  { userId: 'user-admin', roleId: 'role-admin' },
  { userId: 'user-exec', roleId: 'role-exec' },
];

function baseFake(overrides: Partial<Record<string, FakeRow[]>> = {}): FakeCleanupPrismaClient {
  return new FakeCleanupPrismaClient({
    organization: [ORG],
    role: [ADMIN_ROLE, EXEC_ROLE],
    user: [ADMIN_USER, EXEC_USER],
    userRole: [...BASE_USER_ROLES],
    ...overrides,
  } as any);
}

describe('cleanup-staging-test-data', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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

  it('accepts matching STAGING_CLEANUP_TARGET/STAGING_CLEANUP_DATABASE_BRANCH, both "staging"', () => {
    setEnv();
    expect(loadConfig().target).toBe('staging');
  });

  it('rejects any STAGING_CLEANUP_TARGET other than exactly "staging"', () => {
    setEnv({ STAGING_CLEANUP_TARGET: 'development', STAGING_CLEANUP_DATABASE_BRANCH: 'development' });
    expect(() => loadConfig()).toThrow(/STAGING_CLEANUP_TARGET must be exactly "staging"/);
  });

  it('rejects STAGING_CLEANUP_TARGET=production even before reaching the production-specific runApply check', () => {
    setEnv({ STAGING_CLEANUP_TARGET: 'production', STAGING_CLEANUP_DATABASE_BRANCH: 'production' });
    expect(() => loadConfig()).toThrow(/STAGING_CLEANUP_TARGET must be exactly "staging"/);
  });

  it('rejects a STAGING_CLEANUP_DATABASE_BRANCH that does not match STAGING_CLEANUP_TARGET', () => {
    setEnv({ STAGING_CLEANUP_DATABASE_BRANCH: 'production' });
    expect(() => loadConfig()).toThrow(/STAGING_CLEANUP_DATABASE_BRANCH/);
  });

  it('rejects identical keep-admin and keep-executive emails', () => {
    setEnv({ STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL: 'sistema@mejoreferido.cl' });
    expect(() => loadConfig()).toThrow(/must be different accounts/);
  });

  it('requires DATABASE_URL to be set and non-empty', () => {
    const original = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      expect(() => requireDatabaseUrlPresent()).toThrow(/DATABASE_URL/);
      process.env.DATABASE_URL = '   ';
      expect(() => requireDatabaseUrlPresent()).toThrow(/DATABASE_URL/);
      process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
      expect(() => requireDatabaseUrlPresent()).not.toThrow();
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });

  it('requires the exact confirmation WIPE_TEST_DATA_IN_STAGING', () => {
    setEnv();
    expect(() => requireConfirmation('staging')).not.toThrow();
    setEnv({ STAGING_CLEANUP_CONFIRM: 'SOMETHING_ELSE' });
    expect(() => requireConfirmation('staging')).toThrow(/STAGING_CLEANUP_CONFIRM/);
    setEnv({ STAGING_CLEANUP_CONFIRM: undefined });
    expect(() => requireConfirmation('staging')).toThrow(/STAGING_CLEANUP_CONFIRM/);
  });

  it('requires the exact confirmation phrase', () => {
    setEnv();
    expect(() => requirePhraseConfirmation()).not.toThrow();
    setEnv({ STAGING_CLEANUP_CONFIRM_PHRASE: 'wrong phrase' });
    expect(() => requirePhraseConfirmation()).toThrow(/STAGING_CLEANUP_CONFIRM_PHRASE/);
  });

  it('requires STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID to be set', () => {
    setEnv({ STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID: undefined });
    expect(() => requireExpectedOrganizationId()).toThrow(/STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID/);
  });

  // ---------------------------------------------------------------------
  // Backup decision — mutually exclusive, no default
  // ---------------------------------------------------------------------

  describe('resolveBackupDecision', () => {
    it('accepts STAGING_CLEANUP_BACKUP_ACKNOWLEDGED="true" alone', () => {
      setEnvWithBackupAcknowledged();
      expect(resolveBackupDecision()).toBe('backup_acknowledged');
    });

    it('accepts STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP="true" with the exact phrase, alone', () => {
      setEnv();
      expect(resolveBackupDecision()).toBe('proceed_without_backup');
    });

    it('rejects when neither option is selected', () => {
      setEnv({ STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP: undefined, STAGING_CLEANUP_NO_BACKUP_PHRASE: undefined });
      expect(() => resolveBackupDecision()).toThrow(/requires an explicit backup decision/);
    });

    it('rejects when both options are selected', () => {
      setEnv({ STAGING_CLEANUP_BACKUP_ACKNOWLEDGED: 'true' } as any);
      expect(() => resolveBackupDecision()).toThrow(/never both/);
    });

    it('rejects a STAGING_CLEANUP_BACKUP_ACKNOWLEDGED value other than exactly "true"', () => {
      setEnv({ STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP: undefined, STAGING_CLEANUP_NO_BACKUP_PHRASE: undefined, STAGING_CLEANUP_BACKUP_ACKNOWLEDGED: 'yes' } as any);
      expect(() => resolveBackupDecision()).toThrow(/must be exactly "true"/);
    });

    it('rejects a STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP value other than exactly "true"', () => {
      setEnv({ STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP: 'YES' });
      expect(() => resolveBackupDecision()).toThrow(/must be exactly "true"/);
    });

    it('rejects an incorrect or missing STAGING_CLEANUP_NO_BACKUP_PHRASE', () => {
      setEnv({ STAGING_CLEANUP_NO_BACKUP_PHRASE: 'ACEPTO ELIMINAR LOS DATOS' });
      expect(() => resolveBackupDecision()).toThrow(/STAGING_CLEANUP_NO_BACKUP_PHRASE/);

      setEnv({ STAGING_CLEANUP_NO_BACKUP_PHRASE: undefined });
      expect(() => resolveBackupDecision()).toThrow(/STAGING_CLEANUP_NO_BACKUP_PHRASE/);
    });
  });

  // ---------------------------------------------------------------------
  // --check never writes
  // ---------------------------------------------------------------------

  it('--check performs no delete or create operations', async () => {
    const fake = baseFake({ mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }] });
    await runCheck(fake as any, fixedConfig());
    const writeCalls = fake.calls.filter((c) => /deleteMany|\.create$/.test(c));
    expect(writeCalls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // diagnose() outcomes
  // ---------------------------------------------------------------------

  it('blocks when the admin account to keep does not exist', async () => {
    const fake = new FakeCleanupPrismaClient({ organization: [ORG], role: [EXEC_ROLE], user: [EXEC_USER], userRole: [BASE_USER_ROLES[1]] } as any);
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/No user found with email "sistema@mejoreferido.cl"/);
  });

  it('blocks when the executive account to keep does not exist', async () => {
    const fake = new FakeCleanupPrismaClient({ organization: [ORG], role: [ADMIN_ROLE], user: [ADMIN_USER], userRole: [BASE_USER_ROLES[0]] } as any);
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/No user found with email "azambrano@mejoreferido.cl"/);
  });

  it('blocks when the two accounts belong to different organizations', async () => {
    const otherOrgExec: FakeRow = { ...EXEC_USER, organizationId: 'org-2' };
    const fake = new FakeCleanupPrismaClient({
      organization: [ORG, { id: 'org-2', name: 'Other' }],
      role: [ADMIN_ROLE, { ...EXEC_ROLE, organizationId: 'org-2' }],
      user: [ADMIN_USER, otherOrgExec],
      userRole: [BASE_USER_ROLES[0], { userId: 'user-exec', roleId: 'role-exec' }],
    } as any);
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/different organizations/);
  });

  it('blocks when the admin account does not currently hold the ADMIN role', async () => {
    const fake = new FakeCleanupPrismaClient({ organization: [ORG], role: [ADMIN_ROLE, EXEC_ROLE], user: [ADMIN_USER, EXEC_USER], userRole: [BASE_USER_ROLES[1]] } as any);
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/does not currently hold the ADMIN role/);
  });

  it('blocks when a kept account is soft-deleted', async () => {
    const fake = new FakeCleanupPrismaClient({
      organization: [ORG],
      role: [ADMIN_ROLE, EXEC_ROLE],
      user: [{ ...ADMIN_USER, deletedAt: new Date('2026-01-01') }, EXEC_USER],
      userRole: [...BASE_USER_ROLES],
    } as any);
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('BLOCKED');
    expect(diagnosis.reasons.join(' ')).toMatch(/soft-deleted/);
  });

  it('projects NO_CHANGES when the organization already has no other data', async () => {
    const fake = baseFake();
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('NO_CHANGES');
    expect(diagnosis.otherUsersToDelete).toHaveLength(0);
  });

  it('projects READY and reports counts/emails when there is data to delete', async () => {
    const otherUser: FakeRow = { id: 'user-other', organizationId: 'org-1', email: 'ejecutivo2@mejoreferido.cl' };
    const fake = baseFake({
      user: [ADMIN_USER, EXEC_USER, otherUser],
      mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }],
      conversation: [{ id: 'conv-1', organizationId: 'org-1' }],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.result).toBe('READY');
    expect(diagnosis.otherUsersToDelete.map((u) => u.email)).toEqual(['ejecutivo2@mejoreferido.cl']);
    expect(diagnosis.mailboxEmailsToDelete).toEqual(['ventas@cliente.cl']);
    expect(diagnosis.tableCounts.find((t) => t.table === 'mailbox')?.count).toBe(1);
    expect(diagnosis.tableCounts.find((t) => t.table === 'conversation')?.count).toBe(1);
  });

  it('"Conversaciones de prueba" (QA) — --check reports the simulation_conversation_batches count as its own line', async () => {
    const fake = baseFake({
      mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }],
      conversation: [{ id: 'conv-qa-1', organizationId: 'org-1', simulationBatchId: 'batch-1' }],
      simulationConversationBatch: [{ id: 'batch-1', organizationId: 'org-1', mailboxId: 'mb-1', createdByUserId: 'user-admin', idempotencyKey: 'key-1' }],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.tableCounts.find((t) => t.table === 'simulationConversationBatch')?.count).toBe(1);
  });

  it('counts a relation-scoped table (signatureVersion) correctly via its parent signature', async () => {
    const fake = baseFake({
      signature: [{ id: 'sig-1', organizationId: 'org-1', mailboxId: 'mb-1' }],
      signatureVersion: [
        { id: 'sv-1', signatureId: 'sig-1', versionNumber: 1 },
        { id: 'sv-2', signatureId: 'sig-1', versionNumber: 2 },
        { id: 'sv-orphan', signatureId: 'sig-other-org', versionNumber: 1 },
      ],
    });
    const diagnosis = await diagnose(fake as any, fixedConfig());
    expect(diagnosis.tableCounts.find((t) => t.table === 'signatureVersion')?.count).toBe(2);
  });

  // ---------------------------------------------------------------------
  // --apply: deletes org data, preserves the 2 kept users + org + roles + audit
  // ---------------------------------------------------------------------

  it('runs successfully with the backup-acknowledged path, deleting data and preserving the 2 kept users/org/roles/audit', async () => {
    setEnvWithBackupAcknowledged();
    const otherUser: FakeRow = { id: 'user-other', organizationId: 'org-1', email: 'ejecutivo2@mejoreferido.cl' };
    const preExistingAudit: FakeRow = { organizationId: 'org-1', actorId: null, action: 'mailbox.delete', entityType: 'Mailbox', entityId: 'mb-1' };
    const fake = baseFake({
      user: [ADMIN_USER, EXEC_USER, otherUser],
      userRole: [...BASE_USER_ROLES, { userId: 'user-other', roleId: 'role-exec' }],
      mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }],
      conversation: [{ id: 'conv-1', organizationId: 'org-1' }, { id: 'conv-qa-1', organizationId: 'org-1', simulationBatchId: 'batch-1' }],
      simulationConversationBatch: [{ id: 'batch-1', organizationId: 'org-1', mailboxId: 'mb-1', createdByUserId: 'user-admin', idempotencyKey: 'key-1' }],
      signature: [{ id: 'sig-1', organizationId: 'org-1', mailboxId: 'mb-1' }],
      signatureVersion: [{ id: 'sv-1', signatureId: 'sig-1', versionNumber: 1 }],
      auditLog: [preExistingAudit],
    });

    const result = await runApply(fake as any, fixedConfig());

    expect(result.backupDecision).toBe('backup_acknowledged');
    expect(fake.store.user.map((u) => u.id).sort()).toEqual(['user-admin', 'user-exec']);
    expect(fake.store.userRole.map((ur) => ur.userId).sort()).toEqual(['user-admin', 'user-exec']);
    expect(fake.store.mailbox).toHaveLength(0);
    expect(fake.store.conversation).toHaveLength(0);
    expect(fake.store.simulationConversationBatch).toHaveLength(0);
    expect(fake.store.signature).toHaveLength(0);
    expect(fake.store.signatureVersion).toHaveLength(0);
    expect(fake.store.organization).toEqual([ORG]);
    expect(fake.store.role.map((r) => r.id).sort()).toEqual(['role-admin', 'role-exec']);
    // AuditLog is preserved (the pre-existing row) AND a new one is appended for this run.
    expect(fake.store.auditLog).toHaveLength(2);
    expect(fake.store.auditLog[0]).toEqual(preExistingAudit);
    expect(fake.store.auditLog[1].action).toBe('staging_cleanup.apply');
    expect((fake.store.auditLog[1] as any).metadata.backupDecision).toBe('backup_acknowledged');
  });

  it('runs successfully with the explicit proceed-without-backup path and prints the destructive warning', async () => {
    setEnv();
    const warnSpy = jest.spyOn(console, 'warn');
    const fake = baseFake({ mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }] });

    const result = await runApply(fake as any, fixedConfig());

    expect(result.backupDecision).toBe('proceed_without_backup');
    expect(fake.store.mailbox).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(DESTRUCTIVE_NO_BACKUP_WARNING);
    expect((fake.store.auditLog[0] as any).metadata.backupDecision).toBe('proceed_without_backup');
  });

  it('is idempotent — a second --apply run reports NO_CHANGES and deletes nothing further', async () => {
    setEnv();
    const otherUser: FakeRow = { id: 'user-other', organizationId: 'org-1', email: 'ejecutivo2@mejoreferido.cl' };
    const fake = baseFake({
      user: [ADMIN_USER, EXEC_USER, otherUser],
      userRole: [...BASE_USER_ROLES],
      mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }],
    });

    const first = await runApply(fake as any, fixedConfig());
    expect(first.diagnosis.result).toBe('READY');

    const second = await runApply(fake as any, fixedConfig());
    expect(second.diagnosis.result).toBe('NO_CHANGES');
    expect(fake.store.user.map((u) => u.id).sort()).toEqual(['user-admin', 'user-exec']);
    // Only the first run's audit entry exists — NO_CHANGES writes nothing.
    expect(fake.store.auditLog).toHaveLength(1);
  });

  it('refuses to run against target=production regardless of confirmation/backup values', async () => {
    setEnv();
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig({ target: 'production' }))).rejects.toThrow(/production/i);
    expect(fake.store.user).toHaveLength(2);
  });

  it('rejects --apply missing STAGING_CLEANUP_CONFIRM', async () => {
    setEnv({ STAGING_CLEANUP_CONFIRM: undefined });
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/STAGING_CLEANUP_CONFIRM/);
  });

  it('rejects --apply missing STAGING_CLEANUP_CONFIRM_PHRASE', async () => {
    setEnv({ STAGING_CLEANUP_CONFIRM_PHRASE: undefined });
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/STAGING_CLEANUP_CONFIRM_PHRASE/);
  });

  it('rejects --apply when no backup decision is selected', async () => {
    setEnv({ STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP: undefined, STAGING_CLEANUP_NO_BACKUP_PHRASE: undefined });
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/requires an explicit backup decision/);
    expect(fake.store.user).toHaveLength(2);
  });

  it('rejects --apply when both backup decisions are selected', async () => {
    setEnv({ STAGING_CLEANUP_BACKUP_ACKNOWLEDGED: 'true' } as any);
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/never both/);
    expect(fake.store.user).toHaveLength(2);
  });

  it('rejects --apply when the no-backup phrase is incorrect', async () => {
    setEnv({ STAGING_CLEANUP_NO_BACKUP_PHRASE: 'acepto pero mal escrito' });
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/STAGING_CLEANUP_NO_BACKUP_PHRASE/);
    expect(fake.store.user).toHaveLength(2);
  });

  it('rejects --apply missing STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID', async () => {
    setEnv({ STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID: undefined });
    const fake = baseFake();
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID/);
  });

  it('rejects --apply when STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID does not match the resolved organization', async () => {
    setEnv({ STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID: 'org-does-not-exist' });
    const fake = baseFake({ mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'a@b.cl' }] });
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/does not match the organization resolved/);
    expect(fake.store.mailbox).toHaveLength(1);
  });

  it('preserves the 2 protected users across a run that also deletes an unrelated third user', async () => {
    setEnv();
    const otherUser: FakeRow = { id: 'user-other', organizationId: 'org-1', email: 'ejecutivo2@mejoreferido.cl' };
    const fake = baseFake({
      user: [ADMIN_USER, EXEC_USER, otherUser],
      userRole: [...BASE_USER_ROLES, { userId: 'user-other', roleId: 'role-exec' }],
    });

    await runApply(fake as any, fixedConfig());

    const remainingEmails = fake.store.user.map((u) => u.email).sort();
    expect(remainingEmails).toEqual(['azambrano@mejoreferido.cl', 'sistema@mejoreferido.cl']);
    expect(fake.store.userRole.map((ur) => ur.userId).sort()).toEqual(['user-admin', 'user-exec']);
  });

  // ---------------------------------------------------------------------
  // Transaction / rollback / advisory lock
  // ---------------------------------------------------------------------

  it('acquires the advisory lock as the very first operation inside the transaction', async () => {
    setEnv();
    const fake = baseFake();
    await runApply(fake as any, fixedConfig());
    expect(fake.calls[0]).toBe('$queryRaw:advisory_lock');
  });

  it('aborts immediately with no writes when the advisory lock is unavailable', async () => {
    setEnv();
    const fake = baseFake({ mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'a@b.cl' }] });
    fake.lockAvailable = false;
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/holds the lock/);
    expect(fake.store.mailbox).toHaveLength(1);
  });

  it('rolls back every delete for the entire transaction if an operation fails mid-transaction', async () => {
    setEnv();
    const otherUser: FakeRow = { id: 'user-other', organizationId: 'org-1', email: 'ejecutivo2@mejoreferido.cl' };
    const fake = baseFake({
      user: [ADMIN_USER, EXEC_USER, otherUser],
      mailbox: [{ id: 'mb-1', organizationId: 'org-1', email: 'ventas@cliente.cl' }],
      conversation: [{ id: 'conv-1', organizationId: 'org-1' }],
    });
    fake.failOnCall = 'user.deleteMany';
    await expect(runApply(fake as any, fixedConfig())).rejects.toThrow(/Simulated failure/);
    expect(fake.store.mailbox).toHaveLength(1);
    expect(fake.store.conversation).toHaveLength(1);
    expect(fake.store.user).toHaveLength(3);
  });

  // ---------------------------------------------------------------------
  // purgeAssets — post-commit, best-effort
  // ---------------------------------------------------------------------

  it('purgeAssets skips with a warning when r2 mode has no credentials configured', async () => {
    process.env.SIGNATURE_ASSET_STORAGE_MODE = 'r2';
    delete process.env.R2_ACCOUNT_ID;
    const report = await purgeAssets('org-1', ['ventas@cliente.cl']);
    expect(report.mode).toBe('skipped');
    delete process.env.SIGNATURE_ASSET_STORAGE_MODE;
  });

  it('purgeAssets removes the local firmas/{email}/ folder in simulated mode', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'mr-outreach-cleanup-test-'));
    const originalCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      const email = 'ventas@cliente.cl';
      const dir = join(tmpRoot, 'uploads', 'firmas', email);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'asset-1.png'), 'fake-bytes');

      delete process.env.SIGNATURE_ASSET_STORAGE_MODE;
      const report = await purgeAssets('org-1', [email]);

      expect(report.mode).toBe('simulated');
      expect(report.signatureFoldersPurged).toEqual([email]);
      expect(existsSync(dir)).toBe(false);
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
