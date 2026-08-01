/**
 * Fase 1 — every Postgres contract/integration/restart spec calls this
 * before doing anything destructive (deleteMany, migrate, etc.). Refuses
 * to run unless it can positively confirm the active connection is the
 * dedicated test database, never development, staging or production.
 *
 * Deliberately does NOT rely on NODE_ENV=test alone (too easy to leave set
 * from an unrelated shell), on parsing/hardcoding any real hostname, or on
 * DATABASE_URL === TEST_DATABASE_URL alone (that equality would hold just
 * as well if both variables were accidentally pointed at staging or
 * production — matching each other proves nothing about which real branch
 * they match). Instead it requires ALL of these independent signals to
 * agree before anything destructive is allowed to run:
 *   1. NODE_ENV=test
 *   2. DATABASE_ENVIRONMENT=test (an explicit, single-purpose opt-in)
 *   3. TEST_DATABASE_BRANCH=test — a second, human-asserted declaration of
 *      which Neon branch the operator believes is configured. Like
 *      BOOTSTRAP_DATABASE_BRANCH in prisma/bootstrap-admin.ts, this does
 *      NOT technically verify which branch DATABASE_URL points to (a
 *      Postgres connection string carries no queryable branch name) — it
 *      only catches an operator who left a stale/wrong value here.
 *   4. TEST_DATABASE_CONFIRM=ALLOW_DESTRUCTIVE_TESTS_ON_TEST_BRANCH — an
 *      explicit, single-purpose opt-in confirming the operator intends to
 *      run destructive operations right now (never baked into a
 *      committed npm script, so it can't become a rubber stamp).
 *   5. TEST_DATABASE_URL is set.
 *   6. DATABASE_URL is set (required by the current Postgres-backed test
 *      infrastructure, which always reads its connection from
 *      DATABASE_URL) and matches TEST_DATABASE_URL exactly.
 * If any signal is missing, wrong, or the two URLs don't match
 * byte-for-byte, this throws before the caller can run anything
 * destructive. Never logs the value of either URL.
 */
const REQUIRED_TEST_DATABASE_BRANCH = 'test';
const REQUIRED_TEST_DATABASE_CONFIRM = 'ALLOW_DESTRUCTIVE_TESTS_ON_TEST_BRANCH';

export function assertTestDatabaseEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV;
  const databaseEnvironment = process.env.DATABASE_ENVIRONMENT;
  const testDatabaseBranch = process.env.TEST_DATABASE_BRANCH;
  const testDatabaseConfirm = process.env.TEST_DATABASE_CONFIRM;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const activeDatabaseUrl = process.env.DATABASE_URL;

  const problems: string[] = [];
  if (nodeEnv !== 'test') problems.push(`NODE_ENV must be "test" (got ${JSON.stringify(nodeEnv)}).`);
  if (databaseEnvironment !== 'test') {
    problems.push(`DATABASE_ENVIRONMENT must be "test" (got ${JSON.stringify(databaseEnvironment)}).`);
  }
  if (testDatabaseBranch !== REQUIRED_TEST_DATABASE_BRANCH) {
    problems.push(
      `TEST_DATABASE_BRANCH must be exactly "${REQUIRED_TEST_DATABASE_BRANCH}" (got ${JSON.stringify(testDatabaseBranch)}) — refusing to assume which Neon branch is connected.`,
    );
  }
  if (testDatabaseConfirm !== REQUIRED_TEST_DATABASE_CONFIRM) {
    problems.push(
      `TEST_DATABASE_CONFIRM must be exactly "${REQUIRED_TEST_DATABASE_CONFIRM}" (got ${testDatabaseConfirm ? 'a different value' : 'nothing'}).`,
    );
  }
  if (!testDatabaseUrl) problems.push('TEST_DATABASE_URL is not set.');
  if (!activeDatabaseUrl) {
    problems.push('DATABASE_URL is not set — the current Postgres-backed test infrastructure requires it.');
  }
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
