/**
 * Fase 1 — every Postgres contract/integration/restart spec calls this
 * before doing anything destructive (deleteMany, migrate, etc.). Refuses
 * to run unless it can positively confirm the active connection is the
 * dedicated test database, never mr-outreach-dev or production.
 *
 * Deliberately does NOT rely on NODE_ENV=test alone (too easy to leave set
 * from an unrelated shell) or on parsing/hardcoding any real hostname.
 * Instead it requires three independent signals to agree:
 *   1. NODE_ENV=test
 *   2. DATABASE_ENVIRONMENT=test (an explicit, single-purpose opt-in)
 *   3. process.env.DATABASE_URL === process.env.TEST_DATABASE_URL exactly
 *      — i.e. whoever ran this command already overrode DATABASE_URL with
 *      the test branch's own connection string, and it's still there.
 * If any signal is missing or the two URLs don't match byte-for-byte, this
 * throws before the caller can run anything destructive.
 */
export function assertTestDatabaseEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV;
  const databaseEnvironment = process.env.DATABASE_ENVIRONMENT;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const activeDatabaseUrl = process.env.DATABASE_URL;

  const problems: string[] = [];
  if (nodeEnv !== 'test') problems.push(`NODE_ENV must be "test" (got ${JSON.stringify(nodeEnv)}).`);
  if (databaseEnvironment !== 'test') {
    problems.push(`DATABASE_ENVIRONMENT must be "test" (got ${JSON.stringify(databaseEnvironment)}).`);
  }
  if (!testDatabaseUrl) problems.push('TEST_DATABASE_URL is not set.');
  if (!activeDatabaseUrl) problems.push('DATABASE_URL is not set.');
  if (testDatabaseUrl && activeDatabaseUrl && testDatabaseUrl !== activeDatabaseUrl) {
    problems.push('DATABASE_URL does not match TEST_DATABASE_URL exactly — refusing to run against an unconfirmed database.');
  }

  if (problems.length > 0) {
    throw new Error(
      'Refusing to run a destructive Postgres test/migration step — test database environment ' +
        `could not be confirmed:\n- ${problems.join('\n- ')}`,
    );
  }
}
