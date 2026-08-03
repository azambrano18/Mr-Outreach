/**
 * One-off, idempotent repair for a specific, narrowly-scoped data bug:
 * `PrismaMailboxRepository.update()` used to enumerate every field it
 * would write to Postgres by hand, and never included `deletedAt` in that
 * list — so `DeleteMailboxUseCase` recorded `mailbox.delete` (and
 * `mailbox.asset_cleanup_completed`) correctly, ran the R2 asset purge
 * correctly, but the mailbox row's `deletedAt` column silently stayed
 * NULL. The account kept showing up in every operational listing as
 * "Desvinculada" (linkStatus REVOKED, deletedAt NULL). The code bug is
 * fixed separately (see the same commit) — this script repairs the rows
 * it already left in that inconsistent state, without needing direct
 * database access or a hand-written UPDATE.
 *
 * Scope, by design — this is deliberately NOT a general-purpose mailbox
 * repair tool:
 *   - only ever touches a mailbox that has an existing `mailbox.delete`
 *     audit log entry AND a currently-NULL `deletedAt` — that combination
 *     is unambiguous evidence of exactly this bug (the audit only exists
 *     because `DeleteMailboxUseCase` reached the point, inside the same
 *     Postgres transaction, where it tried to persist `deletedAt`);
 *   - never touches `linkStatus`, `assetCleanupStatus`, or any other
 *     field — those already persisted correctly;
 *   - never creates another `mailbox.delete`-style audit entry (that
 *     would misrepresent a second real deletion); records a distinctly
 *     named `mailbox.deleted_at_repaired` entry instead, for traceability;
 *   - never runs the R2 asset purge again — assetCleanupStatus is left
 *     untouched, whatever it already is;
 *   - idempotent — a mailbox already repaired (deletedAt no longer null)
 *     is simply not a candidate on the next run.
 *
 * Modes / usage — same check/apply/advisory-lock/confirmation-phrase
 * conventions as sync-system-roles.ts and bootstrap-admin.ts:
 *
 *   REPAIR_MAILBOX_DELETED_AT_TARGET=staging \
 *   REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH=staging \
 *   npm run prisma:repair-mailbox-deleted-at -- --check
 *
 *   REPAIR_MAILBOX_DELETED_AT_TARGET=staging \
 *   REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH=staging \
 *   REPAIR_MAILBOX_DELETED_AT_CONFIRM=REPAIR_MAILBOX_DELETED_AT_IN_STAGING \
 *   npm run prisma:repair-mailbox-deleted-at -- --apply
 */
import { PrismaClient } from '@prisma/client';
import { parseMode, requireEnv } from './bootstrap-admin';

// Distinct from BOOTSTRAP_LOCK_KEY (891234567891) and SYNC_ROLES_LOCK_KEY
// (891234567892) — never contends with either.
const REPAIR_LOCK_KEY = 891234567893;

interface RepairConfig {
  target: string;
  databaseBranch: string;
}

export interface RepairCandidate {
  mailboxId: string;
  organizationId: string;
  email: string;
  linkStatus: string;
  assetCleanupStatus: string;
  deleteAuditAt: Date;
}

export interface Diagnosis {
  candidates: RepairCandidate[];
}

function loadConfig(): RepairConfig {
  const target = requireEnv('REPAIR_MAILBOX_DELETED_AT_TARGET');
  const databaseBranch = requireEnv('REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH');

  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `REPAIR_MAILBOX_DELETED_AT_DATABASE_BRANCH ("${databaseBranch}") must equal REPAIR_MAILBOX_DELETED_AT_TARGET ("${target}") — refusing to continue on a mismatch.`,
    );
  }

  return { target, databaseBranch };
}

function requireConfirmation(target: string): void {
  const expected = `REPAIR_MAILBOX_DELETED_AT_IN_${target.toUpperCase()}`;
  const actual = process.env.REPAIR_MAILBOX_DELETED_AT_CONFIRM;
  if (actual !== expected) {
    throw new Error(
      `--apply requires REPAIR_MAILBOX_DELETED_AT_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function diagnose(client: any): Promise<Diagnosis> {
  const deleteAudits: { entityId: string; organizationId: string; createdAt: Date }[] = await client.auditLog.findMany({
    where: { action: 'mailbox.delete', entityType: 'Mailbox' },
    select: { entityId: true, organizationId: true, createdAt: true },
  });

  const candidates: RepairCandidate[] = [];
  for (const audit of deleteAudits) {
    const mailbox = await client.mailbox.findUnique({ where: { id: audit.entityId } });
    if (mailbox && mailbox.deletedAt === null && mailbox.organizationId === audit.organizationId) {
      candidates.push({
        mailboxId: mailbox.id,
        organizationId: mailbox.organizationId,
        email: mailbox.email,
        linkStatus: mailbox.linkStatus,
        assetCleanupStatus: mailbox.assetCleanupStatus,
        deleteAuditAt: audit.createdAt,
      });
    }
  }

  return { candidates };
}

function printDiagnosis(config: RepairConfig, diagnosis: Diagnosis): void {
  console.log('=== repair-mailbox-deleted-at --check (read-only) ===');
  console.log(`Target: ${config.target}`);
  console.log(`Declared database branch (human-asserted, not independently verified): ${config.databaseBranch}`);
  console.log(`Candidates found: ${diagnosis.candidates.length}`);
  for (const candidate of diagnosis.candidates) {
    console.log(
      `  -> mailboxId=${candidate.mailboxId} organizationId=${candidate.organizationId} email=${candidate.email} ` +
        `linkStatus=${candidate.linkStatus} assetCleanupStatus=${candidate.assetCleanupStatus} ` +
        `mailbox.delete audited at ${candidate.deleteAuditAt.toISOString()}, deletedAt is currently NULL`,
    );
  }
  if (diagnosis.candidates.length === 0) {
    console.log('  -> nothing to repair.');
  }
}

async function runCheck(client: PrismaClient, config: RepairConfig): Promise<Diagnosis> {
  const diagnosis = await diagnose(client);
  printDiagnosis(config, diagnosis);
  return diagnosis;
}

interface ApplyResult {
  diagnosis: Diagnosis;
}

async function runApply(client: PrismaClient, config: RepairConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  if (config.target.toLowerCase() === 'production') {
    throw new Error(
      'This script refuses to run against REPAIR_MAILBOX_DELETED_AT_TARGET=production. Repairing this in production requires a separate, explicit procedure.',
    );
  }

  let finalDiagnosis!: Diagnosis;

  await client.$transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${REPAIR_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another repair-mailbox-deleted-at --apply run holds the lock — aborting to avoid a race.');
      }

      const diagnosis = await diagnose(tx);
      finalDiagnosis = diagnosis;

      for (const candidate of diagnosis.candidates) {
        await tx.mailbox.update({
          where: { id: candidate.mailboxId },
          data: { deletedAt: candidate.deleteAuditAt },
        });
        await tx.auditLog.create({
          data: {
            organizationId: candidate.organizationId,
            actorId: null,
            action: 'mailbox.deleted_at_repaired',
            entityType: 'Mailbox',
            entityId: candidate.mailboxId,
            metadata: {
              reason: 'PrismaMailboxRepository.update() previously omitted deletedAt from its write — repaired from the existing mailbox.delete audit timestamp.',
              repairedDeletedAt: candidate.deleteAuditAt.toISOString(),
            },
          },
        });
      }
    },
    { timeout: 15_000 },
  );

  return { diagnosis: finalDiagnosis };
}

function printApplyResult(result: ApplyResult): void {
  console.log(`Repaired ${result.diagnosis.candidates.length} mailbox(es).`);
  for (const candidate of result.diagnosis.candidates) {
    console.log(`  -> ${candidate.mailboxId} (${candidate.email}) — deletedAt set to ${candidate.deleteAuditAt.toISOString()}`);
  }
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
      printApplyResult(result);
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

export { REPAIR_LOCK_KEY, diagnose, loadConfig, requireConfirmation, runApply, runCheck };
