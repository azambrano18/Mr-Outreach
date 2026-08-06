import {
  CLEANUP_MAILBOX_LOCK_KEY,
  REQUIRED_CONFIRM_PHRASE,
  loadConfig,
  requireConfirmation,
  requireDatabaseUrlPresent,
  requireExpectedMailboxId,
  requirePhraseConfirmation,
} from './cleanup-single-mailbox';

/**
 * Guard-rail-only coverage — the same class of tests bootstrap-admin.spec.ts/
 * sync-system-roles.spec.ts run for their own confirmation mechanisms. The
 * actual `diagnose`/`runApply` deletion logic is intentionally NOT unit-tested
 * against a fake Prisma client here (unlike cleanup-staging-test-data.ts,
 * which is reused repeatedly and scoped almost entirely by organizationId —
 * a generic fake fits it well). This script is a one-off, narrowly-scoped
 * tool whose query shapes (compound aggregateType/aggregateId filters,
 * multi-hop id resolution through ProspectImport.executionId, etc.) would
 * need a bespoke mock with little reuse value; it was instead validated
 * directly against real staging data (--check before, --apply, --check
 * after confirming NO_CHANGES) — see the operator's own run log.
 */
describe('cleanup-single-mailbox — guard rails', () => {
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
        CLEANUP_MAILBOX_TARGET: 'staging',
        CLEANUP_MAILBOX_DATABASE_BRANCH: 'staging',
        CLEANUP_MAILBOX_EMAIL: 'ventas@empresademostracion.cl',
        ...overrides,
      };
      for (const [key, value] of Object.entries(merged)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    it('accepts a valid staging config, lowercasing the email', () => {
      setEnv({ CLEANUP_MAILBOX_EMAIL: 'Ventas@EmpresaDemostracion.cl' });
      const config = loadConfig();
      expect(config).toEqual({ target: 'staging', databaseBranch: 'staging', email: 'ventas@empresademostracion.cl' });
    });

    it('rejects any target other than the literal string "staging"', () => {
      setEnv({ CLEANUP_MAILBOX_TARGET: 'production', CLEANUP_MAILBOX_DATABASE_BRANCH: 'production' });
      expect(() => loadConfig()).toThrow(/must be exactly "staging"/);
    });

    it('rejects a mismatch between target and database branch', () => {
      setEnv({ CLEANUP_MAILBOX_DATABASE_BRANCH: 'development' });
      expect(() => loadConfig()).toThrow(/must equal CLEANUP_MAILBOX_TARGET/);
    });

    it('throws when CLEANUP_MAILBOX_EMAIL is missing', () => {
      setEnv({ CLEANUP_MAILBOX_EMAIL: undefined });
      expect(() => loadConfig()).toThrow();
    });
  });

  describe('requireDatabaseUrlPresent', () => {
    it('throws when DATABASE_URL is unset or empty', () => {
      delete process.env.DATABASE_URL;
      expect(() => requireDatabaseUrlPresent()).toThrow(/DATABASE_URL must be set/);
      process.env.DATABASE_URL = '   ';
      expect(() => requireDatabaseUrlPresent()).toThrow(/DATABASE_URL must be set/);
    });

    it('passes when DATABASE_URL is a non-empty string', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
      expect(() => requireDatabaseUrlPresent()).not.toThrow();
    });
  });

  describe('requireConfirmation', () => {
    it('requires the exact target-specific phrase, case-sensitive', () => {
      delete process.env.CLEANUP_MAILBOX_CONFIRM;
      expect(() => requireConfirmation('staging')).toThrow(/CLEANUP_MAILBOX_CONFIRM="DELETE_MAILBOX_IN_STAGING"/);

      process.env.CLEANUP_MAILBOX_CONFIRM = 'delete_mailbox_in_staging';
      expect(() => requireConfirmation('staging')).toThrow();

      process.env.CLEANUP_MAILBOX_CONFIRM = 'DELETE_MAILBOX_IN_STAGING';
      expect(() => requireConfirmation('staging')).not.toThrow();
    });
  });

  describe('requirePhraseConfirmation', () => {
    it('requires the exact Spanish confirmation phrase', () => {
      delete process.env.CLEANUP_MAILBOX_CONFIRM_PHRASE;
      expect(() => requirePhraseConfirmation()).toThrow();

      process.env.CLEANUP_MAILBOX_CONFIRM_PHRASE = 'algo distinto';
      expect(() => requirePhraseConfirmation()).toThrow();

      process.env.CLEANUP_MAILBOX_CONFIRM_PHRASE = REQUIRED_CONFIRM_PHRASE;
      expect(() => requirePhraseConfirmation()).not.toThrow();
    });
  });

  describe('requireExpectedMailboxId', () => {
    it('throws when CLEANUP_MAILBOX_EXPECTED_ID is missing', () => {
      delete process.env.CLEANUP_MAILBOX_EXPECTED_ID;
      expect(() => requireExpectedMailboxId()).toThrow();
    });

    it('returns the value when present', () => {
      process.env.CLEANUP_MAILBOX_EXPECTED_ID = 'mailbox-123';
      expect(requireExpectedMailboxId()).toBe('mailbox-123');
    });
  });

  it('uses a lock key distinct from every sibling script (grepped pg_advisory across the repo)', () => {
    // 891234567891 (bootstrap-admin), 891234567892 (sync-system-roles), 891234567893 (cleanup-staging-test-data).
    expect(CLEANUP_MAILBOX_LOCK_KEY).toBe(891234567894);
  });
});
