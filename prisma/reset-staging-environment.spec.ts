import { Prisma } from '@prisma/client';
import {
  BUSINESS_TABLE_ORDER,
  MODEL_CLASSIFICATIONS,
  REQUIRED_AUDIT_CONFIRM,
  REQUIRED_CONFIRM_PHRASE,
  REQUIRED_NO_BACKUP_PHRASE,
  REQUIRED_R2_CONFIRM,
  RESET_STAGING_LOCK_KEY,
  findUnclassifiedModels,
  loadConfig,
  parseResetMode,
  requireBackupWaiver,
  requireConfirmation,
  requireDatabaseUrlPresent,
  requirePhraseConfirmation,
  shouldPurgeAuditLogs,
  shouldPurgeR2Assets,
} from './reset-staging-environment';

/**
 * §5/§18 — schema-coverage + guard-rail coverage, the same class of tests
 * as bootstrap-admin.spec.ts/sync-system-roles.spec.ts/cleanup-single-mailbox.spec.ts
 * run for their own confirmation mechanisms. `diagnose`/`runApply`/`runVerify`
 * are intentionally NOT unit-tested against a fake Prisma client here (same
 * documented trade-off as cleanup-single-mailbox.spec.ts — this script's
 * query shapes are too varied for a generic fake to add real value without
 * becoming a second, parallel implementation of the queries themselves).
 * They were instead validated directly against real staging data:
 *   - `--check` correctly reported the exact residual rows (Domain +
 *     ManagedClient for empresademostracion.cl, azambrano@mejoreferido.cl)
 *     that motivated this whole task, as READY with 28 rows to delete.
 *   - `--check` with a deliberately wrong RESET_STAGING_EXPECTED_ORGANIZATION_ID
 *     correctly returned BLOCKED without reading any business data.
 *   - `--verify` against that same (not yet reset) database correctly
 *     printed "FACTORY RESET INCOMPLETE" and exited with code 2, naming
 *     every residual row and known blocker.
 * `--apply` itself was deliberately never run by the assistant — the
 * operator runs it, per this task's explicit instruction.
 */
describe('reset-staging-environment — schema coverage', () => {
  it('every Prisma model has a MODEL_CLASSIFICATIONS entry (fails if a new model is added without one)', () => {
    const unclassified = findUnclassifiedModels();
    expect(unclassified).toEqual([]);
  });

  it('MODEL_CLASSIFICATIONS has no stale entries for models that no longer exist', () => {
    const realModelNames = new Set(Object.values(Prisma.ModelName) as string[]);
    const staleEntries = Object.keys(MODEL_CLASSIFICATIONS).filter((name) => !realModelNames.has(name));
    expect(staleEntries).toEqual([]);
  });

  it('classifies exactly the expected PRESERVE models', () => {
    const preserved = Object.entries(MODEL_CLASSIFICATIONS)
      .filter(([, classification]) => classification === 'PRESERVE')
      .map(([name]) => name)
      .sort();
    expect(preserved).toEqual(['Organization', 'Permission', 'Role']);
  });

  it('classifies RolePermission as REBOOTSTRAP (never deleted, reconciled post-apply)', () => {
    expect(MODEL_CLASSIFICATIONS.RolePermission).toBe('REBOOTSTRAP');
  });

  it('every model classified DELETE except User/UserRole/AuditLog appears exactly once in BUSINESS_TABLE_ORDER', () => {
    const businessModels = Object.entries(MODEL_CLASSIFICATIONS)
      .filter(([name, classification]) => classification === 'DELETE' && !['User', 'UserRole', 'AuditLog'].includes(name))
      .map(([name]) => name[0].toLowerCase() + name.slice(1));

    const orderedModels = BUSINESS_TABLE_ORDER.map((spec) => spec.model);
    expect(orderedModels.sort()).toEqual(businessModels.sort());

    const seen = new Set<string>();
    for (const model of orderedModels) {
      expect(seen.has(model)).toBe(false);
      seen.add(model);
    }
  });

  it('User, UserRole, and AuditLog are classified DELETE but handled outside BUSINESS_TABLE_ORDER (selective/conditional logic)', () => {
    expect(MODEL_CLASSIFICATIONS.User).toBe('DELETE');
    expect(MODEL_CLASSIFICATIONS.UserRole).toBe('DELETE');
    expect(MODEL_CLASSIFICATIONS.AuditLog).toBe('DELETE');
    expect(BUSINESS_TABLE_ORDER.some((spec) => spec.model === 'user')).toBe(false);
    expect(BUSINESS_TABLE_ORDER.some((spec) => spec.model === 'userRole')).toBe(false);
    expect(BUSINESS_TABLE_ORDER.some((spec) => spec.model === 'auditLog')).toBe(false);
  });
});

describe('reset-staging-environment — guard rails', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('loadConfig', () => {
    function setEnv(overrides: Record<string, string | undefined> = {}): void {
      const merged = {
        RESET_STAGING_TARGET: 'staging',
        RESET_STAGING_DATABASE_BRANCH: 'staging',
        RESET_STAGING_EXPECTED_ORGANIZATION_ID: 'f67bfe7c-b6b2-4452-8ab2-51ce733a8463',
        RESET_STAGING_EXPECTED_ORGANIZATION_NAME: 'MejoReferido',
        RESET_STAGING_KEEP_ADMIN_EMAIL: 'sistema@mejoreferido.cl',
        APP_ENV: undefined,
        ...overrides,
      };
      for (const [key, value] of Object.entries(merged)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    it('accepts a valid staging config', () => {
      setEnv();
      const config = loadConfig();
      expect(config).toEqual({
        target: 'staging',
        databaseBranch: 'staging',
        expectedOrganizationId: 'f67bfe7c-b6b2-4452-8ab2-51ce733a8463',
        expectedOrganizationName: 'MejoReferido',
        keepAdminEmail: 'sistema@mejoreferido.cl',
      });
    });

    it('rejects any target other than the literal string "staging"', () => {
      setEnv({ RESET_STAGING_TARGET: 'production', RESET_STAGING_DATABASE_BRANCH: 'production' });
      expect(() => loadConfig()).toThrow(/must be exactly "staging"/);
    });

    it('rejects a mismatch between target and database branch', () => {
      setEnv({ RESET_STAGING_DATABASE_BRANCH: 'development' });
      expect(() => loadConfig()).toThrow(/must equal RESET_STAGING_TARGET/);
    });

    it('refuses unconditionally when APP_ENV=production, even if TARGET/DATABASE_BRANCH both say staging', () => {
      setEnv({ APP_ENV: 'production' });
      expect(() => loadConfig()).toThrow(/APP_ENV=production/);
    });

    it('allows APP_ENV=staging or unset', () => {
      setEnv({ APP_ENV: 'staging' });
      expect(() => loadConfig()).not.toThrow();
      setEnv({ APP_ENV: undefined });
      expect(() => loadConfig()).not.toThrow();
    });

    it('throws when any required variable is missing', () => {
      for (const key of [
        'RESET_STAGING_TARGET',
        'RESET_STAGING_DATABASE_BRANCH',
        'RESET_STAGING_EXPECTED_ORGANIZATION_ID',
        'RESET_STAGING_EXPECTED_ORGANIZATION_NAME',
        'RESET_STAGING_KEEP_ADMIN_EMAIL',
      ]) {
        setEnv({ [key]: undefined });
        expect(() => loadConfig()).toThrow();
      }
    });
  });

  describe('requireDatabaseUrlPresent', () => {
    it('throws when DATABASE_URL is unset or blank', () => {
      delete process.env.DATABASE_URL;
      expect(() => requireDatabaseUrlPresent()).toThrow(/DATABASE_URL must be set/);
      process.env.DATABASE_URL = '   ';
      expect(() => requireDatabaseUrlPresent()).toThrow(/DATABASE_URL must be set/);
    });

    it('passes for a non-empty value', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
      expect(() => requireDatabaseUrlPresent()).not.toThrow();
    });
  });

  describe('requireConfirmation / requirePhraseConfirmation', () => {
    it('requires the exact confirmation token', () => {
      delete process.env.RESET_STAGING_CONFIRM;
      expect(() => requireConfirmation('staging')).toThrow(/FACTORY_RESET_MR_OUTREACH_STAGING/);
      process.env.RESET_STAGING_CONFIRM = 'factory_reset_mr_outreach_staging';
      expect(() => requireConfirmation('staging')).toThrow();
      process.env.RESET_STAGING_CONFIRM = 'FACTORY_RESET_MR_OUTREACH_STAGING';
      expect(() => requireConfirmation('staging')).not.toThrow();
    });

    it('requires the exact Spanish confirmation phrase', () => {
      delete process.env.RESET_STAGING_CONFIRM_PHRASE;
      expect(() => requirePhraseConfirmation()).toThrow();
      process.env.RESET_STAGING_CONFIRM_PHRASE = 'algo distinto';
      expect(() => requirePhraseConfirmation()).toThrow();
      process.env.RESET_STAGING_CONFIRM_PHRASE = REQUIRED_CONFIRM_PHRASE;
      expect(() => requirePhraseConfirmation()).not.toThrow();
    });
  });

  describe('requireBackupWaiver', () => {
    it('requires RESET_STAGING_PROCEED_WITHOUT_BACKUP="true" plus the exact phrase', () => {
      delete process.env.RESET_STAGING_PROCEED_WITHOUT_BACKUP;
      expect(() => requireBackupWaiver()).toThrow(/PROCEED_WITHOUT_BACKUP/);

      process.env.RESET_STAGING_PROCEED_WITHOUT_BACKUP = 'true';
      delete process.env.RESET_STAGING_NO_BACKUP_PHRASE;
      expect(() => requireBackupWaiver()).toThrow();

      process.env.RESET_STAGING_NO_BACKUP_PHRASE = 'algo distinto';
      expect(() => requireBackupWaiver()).toThrow();

      process.env.RESET_STAGING_NO_BACKUP_PHRASE = REQUIRED_NO_BACKUP_PHRASE;
      expect(() => requireBackupWaiver()).not.toThrow();
    });
  });

  describe('shouldPurgeAuditLogs', () => {
    it('defaults to false (audit logs preserved) when the flag is unset', () => {
      delete process.env.RESET_STAGING_PURGE_AUDIT_LOGS;
      expect(shouldPurgeAuditLogs()).toBe(false);
    });

    it('requires the exact confirm phrase once the flag is set', () => {
      process.env.RESET_STAGING_PURGE_AUDIT_LOGS = 'true';
      delete process.env.RESET_STAGING_AUDIT_CONFIRM;
      expect(() => shouldPurgeAuditLogs()).toThrow();

      process.env.RESET_STAGING_AUDIT_CONFIRM = REQUIRED_AUDIT_CONFIRM;
      expect(shouldPurgeAuditLogs()).toBe(true);
    });
  });

  describe('shouldPurgeR2Assets', () => {
    it('defaults to false when the flag is unset', () => {
      delete process.env.RESET_STAGING_PURGE_R2_ASSETS;
      expect(shouldPurgeR2Assets()).toBe(false);
    });

    it('requires the exact confirm phrase once the flag is set', () => {
      process.env.RESET_STAGING_PURGE_R2_ASSETS = 'true';
      delete process.env.RESET_STAGING_R2_CONFIRM;
      expect(() => shouldPurgeR2Assets()).toThrow();

      process.env.RESET_STAGING_R2_CONFIRM = REQUIRED_R2_CONFIRM;
      expect(shouldPurgeR2Assets()).toBe(true);
    });
  });

  describe('parseResetMode', () => {
    it('accepts exactly one of --check/--apply/--verify', () => {
      expect(parseResetMode(['--check'])).toBe('check');
      expect(parseResetMode(['--apply'])).toBe('apply');
      expect(parseResetMode(['--verify'])).toBe('verify');
    });

    it('rejects zero or more than one mode flag', () => {
      expect(() => parseResetMode([])).toThrow();
      expect(() => parseResetMode(['--check', '--apply'])).toThrow();
      expect(() => parseResetMode(['--check', '--verify'])).toThrow();
    });
  });

  it('uses a lock key distinct from every sibling script', () => {
    // 891234567891 (bootstrap-admin), 891234567892 (sync-system-roles),
    // 891234567893 (cleanup-staging-test-data), 891234567894 (cleanup-single-mailbox).
    expect(RESET_STAGING_LOCK_KEY).toBe(891234567895);
  });
});
