/**
 * Restores a single, specifically-named soft-deleted user back to an
 * active row — built for the exact staging incident where
 * azambrano@mejoreferido.cl was soft-deleted (deletedAt set) but is
 * required, active, by prisma/cleanup-staging-test-data.ts as a protected
 * account, and the "Crear usuario" flow could not simply recreate it
 * (organizationId+email is a hard database unique constraint that does
 * not account for deletedAt — see UsersService.create's restore-on-create
 * branch, fixed in the same change as this script).
 *
 * Deliberately narrow, mirroring UsersService.create's private restore()
 * exactly (same fields touched, same fields deliberately left alone):
 *   - reuses the same userId, never inserts a new row;
 *   - clears deletedAt, sets status=ACTIVE;
 *   - assigns EXECUTIVE (hardcoded — this script is for restoring exactly
 *     this one known account back to its known role, never a generic
 *     "restore with any role" tool; use the "Crear usuario" flow itself
 *     for a different role);
 *   - generates a brand-new temporary password, mustChangePassword=true;
 *   - clears any stale ClientExecutiveAssignment rows (mailbox
 *     assignments are structurally impossible to survive a proper
 *     deletion — see UsersService.remove — so nothing to clear there);
 *   - records `user.restored`, never a second `user.create`/`user.delete`.
 *
 * Modes / usage — same check/apply/advisory-lock/confirmation-phrase
 * conventions as sync-system-roles.ts, bootstrap-admin.ts and
 * repair-mailbox-deleted-at.ts:
 *
 *   RESTORE_USER_TARGET=staging \
 *   RESTORE_USER_DATABASE_BRANCH=staging \
 *   RESTORE_USER_ORGANIZATION_NAME=MejoReferido \
 *   RESTORE_USER_EMAIL=azambrano@mejoreferido.cl \
 *   npm run prisma:restore-staging-user -- --check
 *
 *   RESTORE_USER_TARGET=staging \
 *   RESTORE_USER_DATABASE_BRANCH=staging \
 *   RESTORE_USER_ORGANIZATION_NAME=MejoReferido \
 *   RESTORE_USER_EMAIL=azambrano@mejoreferido.cl \
 *   RESTORE_USER_CONFIRM=RESTORE_DELETED_USER_IN_STAGING \
 *   npm run prisma:restore-staging-user -- --apply
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { isProtectedSystemAccount } from '../apps/api/src/domain/user/protected-system-account';
import { generateTemporaryPassword } from '../apps/api/src/application/users/temporary-password.generator';
import { EXECUTIVE_ROLE_NAME } from '../apps/api/src/modules/seed/system-roles';
import { parseMode, requireEnv } from './bootstrap-admin';

const PASSWORD_HASH_ROUNDS = 10;

// Distinct from every other script's advisory lock key (891234567891,
// 891234567892, 891234567893) — never contends with any of them.
const RESTORE_USER_LOCK_KEY = 891234567894;

type RestoreResult = 'READY' | 'ALREADY_ACTIVE' | 'BLOCKED';

interface RestoreConfig {
  target: string;
  databaseBranch: string;
  organizationName: string;
  email: string;
}

interface OperationalRelations {
  primaryMailboxCount: number;
  secondaryMailboxCount: number;
  clientAssignmentCount: number;
  nonTerminalExecutionCount: number;
}

interface Diagnosis {
  organizationId: string | null;
  userId: string | null;
  normalizedEmail: string;
  currentStatus: string | null;
  deletedAt: Date | null;
  currentRoleName: string | null;
  lastLoginAt: Date | null;
  executiveRoleId: string | null;
  relations: OperationalRelations;
  result: RestoreResult;
  reasons: string[];
}

function loadConfig(): RestoreConfig {
  const target = requireEnv('RESTORE_USER_TARGET');
  const databaseBranch = requireEnv('RESTORE_USER_DATABASE_BRANCH');
  const organizationName = requireEnv('RESTORE_USER_ORGANIZATION_NAME');
  const email = requireEnv('RESTORE_USER_EMAIL');

  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `RESTORE_USER_DATABASE_BRANCH ("${databaseBranch}") must equal RESTORE_USER_TARGET ("${target}") — refusing to continue on a mismatch.`,
    );
  }

  return { target, databaseBranch, organizationName, email: email.trim().toLowerCase() };
}

function requireConfirmation(target: string): void {
  const expected = `RESTORE_DELETED_USER_IN_${target.toUpperCase()}`;
  const actual = process.env.RESTORE_USER_CONFIRM;
  if (actual !== expected) {
    throw new Error(`--apply requires RESTORE_USER_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function diagnose(client: any, config: RestoreConfig): Promise<Diagnosis> {
  const reasons: string[] = [];

  if (isProtectedSystemAccount(config.email)) {
    return {
      organizationId: null,
      userId: null,
      normalizedEmail: config.email,
      currentStatus: null,
      deletedAt: null,
      currentRoleName: null,
      lastLoginAt: null,
      executiveRoleId: null,
      relations: { primaryMailboxCount: 0, secondaryMailboxCount: 0, clientAssignmentCount: 0, nonTerminalExecutionCount: 0 },
      result: 'BLOCKED',
      reasons: ['This script never touches the protected system account (sistema@mejoreferido.cl), unconditionally.'],
    };
  }

  const organizations = await client.organization.findMany({
    where: { name: config.organizationName, deletedAt: null },
    select: { id: true, name: true },
  });
  if (organizations.length !== 1) {
    reasons.push(
      organizations.length === 0
        ? `No organization named "${config.organizationName}" exists.`
        : `${organizations.length} organizations named "${config.organizationName}" exist — ambiguous target, resolve manually before retrying.`,
    );
    return {
      organizationId: null,
      userId: null,
      normalizedEmail: config.email,
      currentStatus: null,
      deletedAt: null,
      currentRoleName: null,
      lastLoginAt: null,
      executiveRoleId: null,
      relations: { primaryMailboxCount: 0, secondaryMailboxCount: 0, clientAssignmentCount: 0, nonTerminalExecutionCount: 0 },
      result: 'BLOCKED',
      reasons,
    };
  }
  const organizationId = organizations[0].id as string;

  // Deliberately NOT scoped by organizationId in this first lookup, so a
  // "belongs to another organization" mismatch gets its own clear reason
  // instead of being indistinguishable from "does not exist at all".
  const matches = await client.user.findMany({
    where: { email: { equals: config.email, mode: 'insensitive' } },
    select: {
      id: true,
      organizationId: true,
      status: true,
      deletedAt: true,
      lastLoginAt: true,
    },
  });

  const inThisOrg = matches.filter((u: { organizationId: string }) => u.organizationId === organizationId);

  if (matches.length === 0) {
    reasons.push(`No user with email "${config.email}" exists in any organization.`);
  } else if (inThisOrg.length === 0) {
    reasons.push(
      `A user with email "${config.email}" exists, but not in organization "${config.organizationName}" (${organizationId}) — refusing to restore across organizations.`,
    );
  } else if (inThisOrg.length > 1) {
    reasons.push(
      `${inThisOrg.length} users with email "${config.email}" exist in this organization — ambiguous, resolve manually before retrying.`,
    );
  }

  const executiveRole = await client.role.findFirst({
    where: { organizationId, name: EXECUTIVE_ROLE_NAME },
    select: { id: true },
  });
  if (!executiveRole) {
    reasons.push(
      `The ${EXECUTIVE_ROLE_NAME} role does not exist yet in organization "${config.organizationName}" — run sync-system-roles first.`,
    );
  }

  if (reasons.length > 0 || matches.length === 0 || inThisOrg.length !== 1 || !executiveRole) {
    return {
      organizationId,
      userId: inThisOrg[0]?.id ?? null,
      normalizedEmail: config.email,
      currentStatus: inThisOrg[0]?.status ?? null,
      deletedAt: inThisOrg[0]?.deletedAt ?? null,
      currentRoleName: null,
      lastLoginAt: inThisOrg[0]?.lastLoginAt ?? null,
      executiveRoleId: executiveRole?.id ?? null,
      relations: { primaryMailboxCount: 0, secondaryMailboxCount: 0, clientAssignmentCount: 0, nonTerminalExecutionCount: 0 },
      result: 'BLOCKED',
      reasons,
    };
  }

  const user = inThisOrg[0] as { id: string; status: string; deletedAt: Date | null; lastLoginAt: Date | null };

  const userRoles = await client.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } });
  const roleIds: string[] = userRoles.map((ur: { roleId: string }) => ur.roleId);
  const roles = roleIds.length > 0 ? await client.role.findMany({ where: { id: { in: roleIds } }, select: { name: true } }) : [];
  const currentRoleName = (roles[0] as { name: string } | undefined)?.name ?? null;

  const [primaryMailboxCount, secondaryMailboxCount, clientAssignmentCount, executions] = await Promise.all([
    client.mailboxAssignment.count({ where: { userId: user.id, role: 'PRIMARY' } }),
    client.mailboxAssignment.count({ where: { userId: user.id, role: 'SECONDARY' } }),
    client.clientExecutiveAssignment.count({ where: { userId: user.id } }),
    client.sequenceExecution.findMany({ where: { executiveId: user.id }, select: { status: true } }),
  ]);
  const NON_TERMINAL_EXECUTION_STATUSES = ['DRAFT', 'VALIDATING', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'RUNNING'];
  const nonTerminalExecutionCount = executions.filter((e: { status: string }) =>
    NON_TERMINAL_EXECUTION_STATUSES.includes(e.status),
  ).length;

  const relations: OperationalRelations = {
    primaryMailboxCount,
    secondaryMailboxCount,
    clientAssignmentCount,
    nonTerminalExecutionCount,
  };

  if (user.deletedAt === null) {
    return {
      organizationId,
      userId: user.id,
      normalizedEmail: config.email,
      currentStatus: user.status,
      deletedAt: null,
      currentRoleName,
      lastLoginAt: user.lastLoginAt,
      executiveRoleId: executiveRole.id,
      relations,
      result: 'ALREADY_ACTIVE',
      reasons: ['deletedAt is already null — nothing to restore (either never deleted, or already restored by a previous run).'],
    };
  }

  return {
    organizationId,
    userId: user.id,
    normalizedEmail: config.email,
    currentStatus: user.status,
    deletedAt: user.deletedAt,
    currentRoleName,
    lastLoginAt: user.lastLoginAt,
    executiveRoleId: executiveRole.id,
    relations,
    result: 'READY',
    reasons: ['User is soft-deleted (deletedAt set) in the correct organization — restoration is possible.'],
  };
}

function printDiagnosis(config: RestoreConfig, diagnosis: Diagnosis): void {
  console.log('=== restore-staging-user --check (read-only) ===');
  console.log(`Target: ${config.target}`);
  console.log(`Declared database branch (human-asserted, not independently verified): ${config.databaseBranch}`);
  console.log(`Organization requested: "${config.organizationName}" -> ${diagnosis.organizationId ?? '(not found)'}`);
  console.log(`Normalized email: ${diagnosis.normalizedEmail}`);
  console.log(`userId: ${diagnosis.userId ?? '(not found)'}`);
  console.log(`Current status: ${diagnosis.currentStatus ?? '—'}`);
  console.log(`deletedAt: ${diagnosis.deletedAt ? diagnosis.deletedAt.toISOString() : 'null'}`);
  console.log(`Current role: ${diagnosis.currentRoleName ?? '—'}`);
  // No server-side session/refresh-token store exists in this app (stateless
  // JWT, revalidated against the live user row on every request) — lastLoginAt
  // is the closest honest signal of recent activity, printed as such rather
  // than fabricating an "active sessions" count that doesn't exist.
  console.log(`Last login (no session store exists — informational only): ${diagnosis.lastLoginAt ? diagnosis.lastLoginAt.toISOString() : 'never'}`);
  console.log(
    `Existing operational relations: ${diagnosis.relations.primaryMailboxCount} primary mailbox(es), ` +
      `${diagnosis.relations.secondaryMailboxCount} secondary mailbox(es), ${diagnosis.relations.clientAssignmentCount} client assignment(s), ` +
      `${diagnosis.relations.nonTerminalExecutionCount} non-terminal Gestión(es) — none of these are restored by --apply.`,
  );
  console.log(`\nProjected action: ${diagnosis.result === 'READY' ? `restore to ACTIVE with role ${EXECUTIVE_ROLE_NAME}` : 'none'}`);
  console.log(`Result: ${diagnosis.result === 'READY' ? 'READY' : diagnosis.result === 'ALREADY_ACTIVE' ? 'READY (no-op — already active)' : 'BLOCKED'}`);
  console.log('Reasons:');
  diagnosis.reasons.forEach((reason) => console.log(`  - ${reason}`));
}

async function runCheck(client: PrismaClient, config: RestoreConfig): Promise<Diagnosis> {
  const diagnosis = await diagnose(client, config);
  printDiagnosis(config, diagnosis);
  if (diagnosis.result === 'BLOCKED') {
    process.exitCode = 1;
  }
  return diagnosis;
}

interface ApplyResult {
  diagnosis: Diagnosis;
  temporaryPassword: string | null;
}

async function runApply(client: PrismaClient, config: RestoreConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  if (config.target.toLowerCase() === 'production') {
    throw new Error('This script refuses to run against RESTORE_USER_TARGET=production. Restoring a user in production requires a separate, explicit procedure.');
  }

  let finalDiagnosis!: Diagnosis;
  let temporaryPassword: string | null = null;

  await client.$transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${RESTORE_USER_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another restore-staging-user --apply run holds the lock — aborting to avoid a race.');
      }

      const diagnosis = await diagnose(tx, config);
      finalDiagnosis = diagnosis;

      if (diagnosis.result === 'BLOCKED') {
        throw new Error(`Blocked: ${diagnosis.reasons.join(' ')}`);
      }
      if (diagnosis.result === 'ALREADY_ACTIVE') {
        // Idempotent no-op — never a second password, never a duplicate audit.
        return;
      }

      const userId = diagnosis.userId as string;
      const executiveRoleId = diagnosis.executiveRoleId as string;

      const generatedPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(generatedPassword, PASSWORD_HASH_ROUNDS);

      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'ACTIVE',
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          deletedAt: null,
        },
      });

      const existingRoles = await tx.userRole.findMany({ where: { userId }, select: { roleId: true } });
      if (existingRoles.length > 0) {
        await tx.userRole.deleteMany({ where: { userId } });
      }
      await tx.userRole.create({ data: { userId, roleId: executiveRoleId } });

      const staleClientAssignments = await tx.clientExecutiveAssignment.findMany({
        where: { userId },
        select: { clientId: true },
      });
      if (staleClientAssignments.length > 0) {
        await tx.clientExecutiveAssignment.deleteMany({ where: { userId } });
      }

      await tx.auditLog.create({
        data: {
          organizationId: diagnosis.organizationId,
          actorId: null,
          action: 'user.restored',
          entityType: 'User',
          entityId: userId,
          metadata: {
            email: diagnosis.normalizedEmail,
            roleName: EXECUTIVE_ROLE_NAME,
            previouslyDeletedAt: diagnosis.deletedAt ? diagnosis.deletedAt.toISOString() : null,
            clientAssignmentsCleared: staleClientAssignments.length,
            restoredVia: 'prisma/restore-staging-user.ts --apply',
          },
        },
      });

      temporaryPassword = generatedPassword;
    },
    { timeout: 15_000 },
  );

  return { diagnosis: finalDiagnosis, temporaryPassword };
}

function printApplyResult(config: RestoreConfig, result: ApplyResult): void {
  if (result.diagnosis.result === 'ALREADY_ACTIVE') {
    console.log(`User ${config.email} is already active — nothing to restore. No password generated, no audit duplicated.`);
    return;
  }
  console.log(`User ${config.email} (${result.diagnosis.userId}) restored to ACTIVE with role ${EXECUTIVE_ROLE_NAME}.`);
  console.log('mustChangePassword is now true — the user must set a real password on next login.');
  console.log('');
  console.log('=== ONE-TIME TEMPORARY PASSWORD — shown only here, never logged or audited ===');
  console.log(result.temporaryPassword);
  console.log('===============================================================================');
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const config = loadConfig();
  const prisma = new PrismaClient();

  try {
    if (mode === 'check') {
      await runCheck(prisma, config);
    } else {
      const result = await runApply(prisma, config);
      printApplyResult(config, result);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { RESTORE_USER_LOCK_KEY, diagnose, loadConfig, requireConfirmation, runApply, runCheck };
