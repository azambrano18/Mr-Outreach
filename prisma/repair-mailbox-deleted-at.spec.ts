import { diagnose, loadConfig, requireConfirmation, runApply, runCheck } from './repair-mailbox-deleted-at';
import { FakeMailbox, FakePrismaClient } from './test-support/fake-prisma-client';

const VALID_ENV = {
  REPAIR_MAILBOX_DELETED_AT_TARGET: 'staging',
  REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH: 'staging',
  REPAIR_MAILBOX_DELETED_AT_CONFIRM: 'REPAIR_MAILBOX_DELETED_AT_IN_STAGING',
} as const;

function setEnv(overrides: Partial<Record<keyof typeof VALID_ENV, string | undefined>> = {}): void {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const AFFECTED_MAILBOX: FakeMailbox = {
  id: 'mailbox-1',
  organizationId: 'org-1',
  email: 'ventas@empresademostracion.cl',
  linkStatus: 'REVOKED',
  assetCleanupStatus: 'COMPLETED',
  deletedAt: null,
};

const DELETE_AUDIT_AT = new Date('2026-08-01T12:00:00.000Z');

function clientWithBuggyDeletedRow(): FakePrismaClient {
  const fake = new FakePrismaClient({ mailboxes: [{ ...AFFECTED_MAILBOX }] });
  fake.store.auditLogs.push({
    organizationId: 'org-1',
    actorId: 'admin-1',
    action: 'mailbox.delete',
    entityType: 'Mailbox',
    entityId: AFFECTED_MAILBOX.id,
    metadata: {},
    createdAt: DELETE_AUDIT_AT,
  });
  return fake;
}

describe('repair-mailbox-deleted-at', () => {
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
  });

  it('rejects a DATABASE_BRANCH that does not match TARGET', () => {
    setEnv({ REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH: 'production' });
    expect(() => loadConfig()).toThrow(/DATABASE_BRANCH/);
  });

  it('requires the exact confirmation phrase for --apply', () => {
    setEnv();
    expect(() => requireConfirmation('staging')).not.toThrow();

    setEnv({ REPAIR_MAILBOX_DELETED_AT_CONFIRM: 'SOMETHING_ELSE' });
    expect(() => requireConfirmation('staging')).toThrow(/REPAIR_MAILBOX_DELETED_AT_CONFIRM/);

    setEnv({ REPAIR_MAILBOX_DELETED_AT_CONFIRM: undefined });
    expect(() => requireConfirmation('staging')).toThrow(/REPAIR_MAILBOX_DELETED_AT_CONFIRM/);
  });

  describe('diagnose', () => {
    it('finds a mailbox with a mailbox.delete audit but a still-NULL deletedAt — exactly the bug this script repairs', async () => {
      const fake = clientWithBuggyDeletedRow();
      const diagnosis = await diagnose(fake as any);
      expect(diagnosis.candidates).toHaveLength(1);
      expect(diagnosis.candidates[0]).toMatchObject({
        mailboxId: 'mailbox-1',
        organizationId: 'org-1',
        email: 'ventas@empresademostracion.cl',
        linkStatus: 'REVOKED',
        assetCleanupStatus: 'COMPLETED',
        deleteAuditAt: DELETE_AUDIT_AT,
      });
    });

    it('never flags a mailbox whose deletedAt is already set — already repaired, or never affected', async () => {
      const fake = new FakePrismaClient({
        mailboxes: [{ ...AFFECTED_MAILBOX, deletedAt: new Date() }],
      });
      fake.store.auditLogs.push({
        organizationId: 'org-1',
        actorId: 'admin-1',
        action: 'mailbox.delete',
        entityType: 'Mailbox',
        entityId: AFFECTED_MAILBOX.id,
        metadata: {},
        createdAt: DELETE_AUDIT_AT,
      });
      const diagnosis = await diagnose(fake as any);
      expect(diagnosis.candidates).toHaveLength(0);
    });

    it('never flags a mailbox with no mailbox.delete audit at all — a merely REVOKED (not deleted) account must never be touched', async () => {
      const fake = new FakePrismaClient({ mailboxes: [{ ...AFFECTED_MAILBOX }] });
      const diagnosis = await diagnose(fake as any);
      expect(diagnosis.candidates).toHaveLength(0);
    });

    it('ignores an audit entry whose entityId no longer resolves to any mailbox', async () => {
      const fake = new FakePrismaClient();
      fake.store.auditLogs.push({
        organizationId: 'org-1',
        actorId: 'admin-1',
        action: 'mailbox.delete',
        entityType: 'Mailbox',
        entityId: 'mailbox-does-not-exist',
        metadata: {},
        createdAt: DELETE_AUDIT_AT,
      });
      const diagnosis = await diagnose(fake as any);
      expect(diagnosis.candidates).toHaveLength(0);
    });

    it('ignores an audit entry whose organizationId no longer matches the mailbox — cross-organization isolation', async () => {
      const fake = new FakePrismaClient({ mailboxes: [{ ...AFFECTED_MAILBOX, organizationId: 'org-2' }] });
      fake.store.auditLogs.push({
        organizationId: 'org-1',
        actorId: 'admin-1',
        action: 'mailbox.delete',
        entityType: 'Mailbox',
        entityId: AFFECTED_MAILBOX.id,
        metadata: {},
        createdAt: DELETE_AUDIT_AT,
      });
      const diagnosis = await diagnose(fake as any);
      expect(diagnosis.candidates).toHaveLength(0);
    });
  });

  describe('--check', () => {
    it('never writes', async () => {
      const fake = clientWithBuggyDeletedRow();
      await runCheck(fake as any, { target: 'staging', databaseBranch: 'staging' });
      const writeCalls = fake.calls.filter((c) => /update|create/.test(c));
      expect(writeCalls).toHaveLength(0);
      expect(fake.store.mailboxes[0].deletedAt).toBeNull();
    });
  });

  describe('--apply', () => {
    it('sets deletedAt to the mailbox.delete audit timestamp and records a distinct repair audit — never a second mailbox.delete', async () => {
      setEnv();
      const fake = clientWithBuggyDeletedRow();

      const result = await runApply(fake as any, { target: 'staging', databaseBranch: 'staging' });

      expect(result.diagnosis.candidates).toHaveLength(1);
      expect(fake.store.mailboxes[0].deletedAt).toEqual(DELETE_AUDIT_AT);
      // Never touched — only deletedAt is repaired.
      expect(fake.store.mailboxes[0].linkStatus).toBe('REVOKED');
      expect(fake.store.mailboxes[0].assetCleanupStatus).toBe('COMPLETED');

      const repairAudits = fake.store.auditLogs.filter((a) => a.action === 'mailbox.deleted_at_repaired');
      expect(repairAudits).toHaveLength(1);
      const secondDeleteAudits = fake.store.auditLogs.filter((a) => a.action === 'mailbox.delete');
      expect(secondDeleteAudits).toHaveLength(1); // only the original one, never a fabricated second one.
    });

    it('is idempotent — running --apply a second time makes no further changes', async () => {
      setEnv();
      const fake = clientWithBuggyDeletedRow();

      await runApply(fake as any, { target: 'staging', databaseBranch: 'staging' });
      const secondResult = await runApply(fake as any, { target: 'staging', databaseBranch: 'staging' });

      expect(secondResult.diagnosis.candidates).toHaveLength(0);
      const repairAudits = fake.store.auditLogs.filter((a) => a.action === 'mailbox.deleted_at_repaired');
      expect(repairAudits).toHaveLength(1); // not duplicated on the second run.
    });

    it('refuses to run against production, unconditionally', async () => {
      setEnv({
        REPAIR_MAILBOX_DELETED_AT_TARGET: 'production',
        REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH: 'production',
        REPAIR_MAILBOX_DELETED_AT_CONFIRM: 'REPAIR_MAILBOX_DELETED_AT_IN_PRODUCTION',
      });
      const fake = clientWithBuggyDeletedRow();
      await expect(runApply(fake as any, { target: 'production', databaseBranch: 'production' })).rejects.toThrow(
        /refuses to run against/,
      );
    });

    it('requires the confirmation phrase before writing anything', async () => {
      setEnv({ REPAIR_MAILBOX_DELETED_AT_CONFIRM: undefined });
      const fake = clientWithBuggyDeletedRow();
      await expect(runApply(fake as any, { target: 'staging', databaseBranch: 'staging' })).rejects.toThrow(
        /REPAIR_MAILBOX_DELETED_AT_CONFIRM/,
      );
      expect(fake.store.mailboxes[0].deletedAt).toBeNull();
    });

    it('rolls back entirely if the advisory lock is unavailable', async () => {
      setEnv();
      const fake = clientWithBuggyDeletedRow();
      fake.lockAvailable = false;
      await expect(runApply(fake as any, { target: 'staging', databaseBranch: 'staging' })).rejects.toThrow(/lock/);
      expect(fake.store.mailboxes[0].deletedAt).toBeNull();
    });
  });
});
