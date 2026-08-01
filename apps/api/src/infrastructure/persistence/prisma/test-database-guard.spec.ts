import { assertTestDatabaseEnvironment } from './test-database-guard';

const VALID_ENV = {
  NODE_ENV: 'test',
  DATABASE_ENVIRONMENT: 'test',
  TEST_DATABASE_BRANCH: 'test',
  TEST_DATABASE_CONFIRM: 'ALLOW_DESTRUCTIVE_TESTS_ON_TEST_BRANCH',
  TEST_DATABASE_URL: 'postgresql://user:pass@test-host/db',
  DATABASE_URL: 'postgresql://user:pass@test-host/db',
} as const;

describe('assertTestDatabaseEnvironment', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function setEnv(overrides: Partial<Record<keyof typeof VALID_ENV, string | undefined>>): void {
    const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  it('1. accepts a fully valid test configuration', () => {
    setEnv({});
    expect(() => assertTestDatabaseEnvironment()).not.toThrow();
  });

  it('2. rejects a missing TEST_DATABASE_BRANCH', () => {
    setEnv({ TEST_DATABASE_BRANCH: undefined });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_BRANCH/);
  });

  it('3. rejects TEST_DATABASE_BRANCH=staging', () => {
    setEnv({ TEST_DATABASE_BRANCH: 'staging' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_BRANCH/);
  });

  it('4. rejects TEST_DATABASE_BRANCH=development', () => {
    setEnv({ TEST_DATABASE_BRANCH: 'development' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_BRANCH/);
  });

  it('5. rejects TEST_DATABASE_BRANCH=production', () => {
    setEnv({ TEST_DATABASE_BRANCH: 'production' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_BRANCH/);
  });

  it('6. rejects a missing TEST_DATABASE_CONFIRM', () => {
    setEnv({ TEST_DATABASE_CONFIRM: undefined });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_CONFIRM/);
  });

  it('7. rejects an incorrect TEST_DATABASE_CONFIRM value', () => {
    setEnv({ TEST_DATABASE_CONFIRM: 'YES_DO_IT' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_CONFIRM/);
  });

  it('8. rejects a missing TEST_DATABASE_URL', () => {
    setEnv({ TEST_DATABASE_URL: undefined });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it('9. rejects DATABASE_URL and TEST_DATABASE_URL pointing to different values', () => {
    setEnv({ DATABASE_URL: 'postgresql://user:pass@a-different-host/db' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/does not match TEST_DATABASE_URL/);
  });

  it('10. rejects matching URLs when TEST_DATABASE_BRANCH is missing (URL equality alone is not sufficient)', () => {
    setEnv({ TEST_DATABASE_BRANCH: undefined });
    // DATABASE_URL and TEST_DATABASE_URL still match byte-for-byte here —
    // this is exactly the scenario the extra branch/confirm signals exist
    // to catch: two URLs agreeing with each other proves nothing about
    // which real Neon branch they both happen to point to.
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(() => assertTestDatabaseEnvironment()).toThrow(/TEST_DATABASE_BRANCH/);
  });

  it('rejects NODE_ENV different from "test"', () => {
    setEnv({ NODE_ENV: 'development' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/NODE_ENV/);
  });

  it('rejects DATABASE_ENVIRONMENT different from "test"', () => {
    setEnv({ DATABASE_ENVIRONMENT: 'staging' });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/DATABASE_ENVIRONMENT/);
  });

  it('rejects a missing DATABASE_URL', () => {
    setEnv({ DATABASE_URL: undefined });
    expect(() => assertTestDatabaseEnvironment()).toThrow(/DATABASE_URL is not set/);
  });

  it('never includes the connection string value in the thrown error message', () => {
    setEnv({ DATABASE_URL: 'postgresql://user:pass@a-different-host/db' });
    try {
      assertTestDatabaseEnvironment();
      fail('expected assertTestDatabaseEnvironment to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('postgresql://');
      expect(message).not.toContain('a-different-host');
    }
  });
});
