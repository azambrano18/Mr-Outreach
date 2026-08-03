/**
 * One-off, auditable, idempotent wipe of operational/test data in a
 * non-production environment, preserving exactly two users (one ADMIN, one
 * EXECUTIVE), their organization, the system roles/permission catalog, and
 * `_prisma_migrations`. Built to reset staging to a clean state for a fresh
 * end-to-end functional test, without ever touching production and without
 * ever leaving the database in a partially-wiped state.
 *
 * Distinct from prisma/bootstrap-admin.ts and prisma/sync-system-roles.ts:
 * those only ever CREATE/RECONCILE rows. This script DELETES rows — real,
 * permanent, hard deletes (`DELETE FROM ...`), not soft-deletes — because
 * the goal is a database state indistinguishable from a brand-new
 * organization, not merely a UI that looks empty while old rows still exist
 * (a soft-delete would already satisfy the second, weaker goal, which is
 * explicitly NOT what was asked for). It shares this file's three sibling
 * scripts' exact conventions: `--check`/`--apply` modes, an explicit
 * `*_CONFIRM` value, an unconditional refusal on `TARGET=production`, a
 * transaction-scoped `pg_advisory_xact_lock`, and a single transaction for
 * every write.
 *
 * What survives every run, unconditionally:
 *   - the Organization row itself
 *   - exactly two User rows: STAGING_CLEANUP_KEEP_ADMIN_EMAIL (must hold the
 *     ADMIN role) and STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL (must hold the
 *     EXECUTIVE role) — matched case-insensitively, both must already exist,
 *     already belong to the SAME organization, and already hold their
 *     expected role before --apply will do anything (this script only
 *     deletes; it never creates or reassigns a role — see
 *     prisma/sync-system-roles.ts for that)
 *   - every Role and Permission row (ADMIN, EXECUTIVE, the full catalog),
 *     and both kept users' UserRole/RolePermission rows
 *   - `_prisma_migrations` (Prisma's own migration history — never touched
 *     by application code in this repo, only by `prisma migrate` itself)
 *   - AuditLog rows — deliberately PRESERVED, not deleted. Nothing in the
 *     schema references AuditLog (no FK points at it), so deleting it was
 *     never required for correctness; keeping it means every table this
 *     script *does* wipe still has a legible trail of what existed and who
 *     touched it before the wipe, plus this run's own audit entry (written
 *     at the end of the same transaction) recording exactly what was
 *     deleted. If a from-scratch audit trail is ever required instead,
 *     that's a separate, explicit decision — not a side effect of this
 *     script.
 *
 * Every other row scoped to the two kept users' organization is deleted —
 * including mailboxes, plantillas, gestiones, conversaciones, clientes,
 * dominios, importaciones and every operational/test row those tables
 * point to. Rows for a DIFFERENT organization (if one exists) are never
 * touched: this script resolves exactly one organization (the one the two
 * kept users belong to) and scopes every delete to it.
 *
 * Deletion order (children before parents, verified against every `@relation`
 * in prisma/schema.prisma as of the migration that introduced R2 asset
 * storage — see docs/staging-cleanup-procedure.md for the full FK graph this
 * was derived from): conversation read-states/tag-assignments/notes/messages
 * -> conversations -> conversation tags -> scheduled emails -> prospect
 * import rows -> sequence step versions -> sequence steps -> sequence
 * contacts -> prospect imports -> sequence import rows -> sequence imports
 * -> contacts -> sequence executions -> sequence template versions ->
 * sequence template steps -> sequence templates -> companies -> sequences
 * -> signature versions -> signatures -> signature assets -> email body
 * assets -> integration events -> integration commands -> client executive
 * assignments -> mailbox assignments -> mailbox connection tests ->
 * mailboxes -> domains -> managed clients -> variables -> templates -> the
 * non-kept users' UserRole rows -> the non-kept users themselves. This
 * exact order is also what makes the DB-level guarantee real: even if a
 * future schema change silently invalidates one step of this ordering,
 * Postgres itself will reject the offending DELETE with a foreign-key
 * violation and roll back the ENTIRE transaction — never a partial wipe.
 *
 * R2/local asset cleanup (firmas/{email}/ per deleted mailbox, plus
 * email-body/{organizationId}/ as a whole) happens AFTER the transaction
 * commits, exactly like DeleteMailboxUseCase's own post-commit cleanup —
 * best-effort, logged, and never able to roll back already-committed
 * Postgres state. A failure here is reported clearly but does not mean the
 * data wipe itself failed.
 *
 * What this script never does (by design):
 *   - DROP DATABASE / DROP SCHEMA / TRUNCATE / disable constraints
 *   - touch Organization, Role, Permission, RolePermission, or
 *     `_prisma_migrations`
 *   - touch a User other than the two explicitly kept ones or a row
 *     scoped to a DIFFERENT organization
 *   - run with STAGING_CLEANUP_TARGET anything other than the literal
 *     string "staging" — unconditionally, no confirmation value overrides
 *     this (this also makes `production` impossible to reach, but the
 *     dedicated production check further below is kept anyway as a second,
 *     independent layer — see its own comment)
 *   - run with DATABASE_URL unset or empty
 *   - print a credential, or a connection string, of any kind
 *
 * `--apply` additionally requires the operator to make an explicit,
 * mutually-exclusive backup decision — there is no default:
 *   - STAGING_CLEANUP_BACKUP_ACKNOWLEDGED="true" — "I created a Neon
 *     backup/branch snapshot by hand before running this."
 *   - STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP="true" + the exact phrase in
 *     STAGING_CLEANUP_NO_BACKUP_PHRASE — "I explicitly accept running
 *     without a backup; the deleted data cannot be recovered." Neon
 *     `staging` is a deliberately disposable environment; this path exists
 *     for exactly that case and is not a lesser-protected shortcut — it
 *     still requires every other confirmation below.
 * Setting neither, both, or an incorrect phrase all fail loudly (see
 * `resolveBackupDecision`). Choosing the no-backup path prints an explicit
 * warning to the console immediately before the destructive transaction
 * runs.
 *
 * `--apply` also requires STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID — the
 * organization id printed by a `--check` run against this same database.
 * `--apply` re-resolves the organization itself (from the two kept
 * accounts, exactly like `--check` does) and refuses to continue if it
 * doesn't match this value. There is no session/token linking a `--check`
 * run to a later `--apply` run — this is the concrete mechanism that ties
 * them together: you cannot supply an organization id you didn't get from
 * having actually run `--check`.
 *
 * Usage:
 *   STAGING_CLEANUP_TARGET=staging \
 *   STAGING_CLEANUP_DATABASE_BRANCH=staging \
 *   STAGING_CLEANUP_KEEP_ADMIN_EMAIL=sistema@mejoreferido.cl \
 *   STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL=azambrano@mejoreferido.cl \
 *   npm run prisma:cleanup-staging-test-data -- --check
 *
 *   # Only after reviewing --check's output. Pick exactly ONE of the two
 *   # backup-decision variables below — see docs/staging-cleanup-procedure.md.
 *   STAGING_CLEANUP_TARGET=staging \
 *   STAGING_CLEANUP_DATABASE_BRANCH=staging \
 *   STAGING_CLEANUP_KEEP_ADMIN_EMAIL=sistema@mejoreferido.cl \
 *   STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL=azambrano@mejoreferido.cl \
 *   STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID=<id printed by --check> \
 *   STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP=true \
 *   STAGING_CLEANUP_NO_BACKUP_PHRASE="ACEPTO ELIMINAR DEFINITIVAMENTE LOS DATOS DE STAGING SIN RESPALDO" \
 *   STAGING_CLEANUP_CONFIRM=WIPE_TEST_DATA_IN_STAGING \
 *   STAGING_CLEANUP_CONFIRM_PHRASE="ELIMINAR DATOS DE PRUEBA STAGING" \
 *   npm run prisma:cleanup-staging-test-data -- --apply
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Prisma, PrismaClient } from '@prisma/client';
import { ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME } from '../apps/api/src/modules/seed/system-roles';
import { buildSignatureFolderPrefix, normalizeMailboxEmailForStorageKey } from '../apps/api/src/domain/signature-asset/normalize-mailbox-email-for-storage';
import { parseMode, requireEnv } from './bootstrap-admin';

// One higher than sync-system-roles' (891234567892) — grepped `pg_advisory`
// across the repo before choosing it; none of the three scripts can ever
// contend for the same lock.
const CLEANUP_LOCK_KEY = 891234567893;

type Mode = 'check' | 'apply';
type ProjectedResult = 'READY' | 'NO_CHANGES' | 'BLOCKED';

interface CleanupConfig {
  target: string;
  databaseBranch: string;
  keepAdminEmail: string;
  keepExecutiveEmail: string;
}

interface KeptUser {
  id: string;
  email: string;
  organizationId: string;
  status: string;
  deletedAt: Date | null;
  hasExpectedRole: boolean;
}

interface OtherUser {
  id: string;
  email: string;
}

interface TableCount {
  table: string;
  count: number;
}

interface Diagnosis {
  organizationId: string | null;
  organizationName: string | null;
  adminUser: KeptUser | null;
  executiveUser: KeptUser | null;
  otherUsersToDelete: OtherUser[];
  mailboxEmailsToDelete: string[];
  tableCounts: TableCount[];
  auditLogCountPreserved: number;
  result: ProjectedResult;
  reasons: string[];
}

function loadConfig(): CleanupConfig {
  const target = requireEnv('STAGING_CLEANUP_TARGET');
  const databaseBranch = requireEnv('STAGING_CLEANUP_DATABASE_BRANCH');
  const keepAdminEmail = requireEnv('STAGING_CLEANUP_KEEP_ADMIN_EMAIL').toLowerCase();
  const keepExecutiveEmail = requireEnv('STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL').toLowerCase();

  // This script is authorized for `staging` only — not "anything that
  // isn't production" like its two siblings. Tightened deliberately: this
  // script deletes rows, theirs only ever create/reconcile them.
  if (target.toLowerCase() !== 'staging') {
    throw new Error(`STAGING_CLEANUP_TARGET must be exactly "staging" (got "${target}").`);
  }
  // Same redundant, human-asserted double-confirmation as the other two
  // scripts — does not technically verify which Neon branch DATABASE_URL
  // points at, only catches a copy-paste mismatch between the two variables.
  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `STAGING_CLEANUP_DATABASE_BRANCH ("${databaseBranch}") must equal STAGING_CLEANUP_TARGET ("${target}") — refusing to continue on a mismatch.`,
    );
  }
  if (keepAdminEmail === keepExecutiveEmail) {
    throw new Error('STAGING_CLEANUP_KEEP_ADMIN_EMAIL and STAGING_CLEANUP_KEEP_EXECUTIVE_EMAIL must be different accounts.');
  }

  return { target, databaseBranch, keepAdminEmail, keepExecutiveEmail };
}

// Prisma itself would eventually fail without this, but with a much less
// clear error — this gives an immediate, unambiguous one. Never logs the
// value, only whether it is present.
function requireDatabaseUrlPresent(): void {
  const value = process.env.DATABASE_URL;
  if (!value || value.trim().length === 0) {
    throw new Error('DATABASE_URL must be set and non-empty.');
  }
}

function requireConfirmation(target: string): void {
  const expected = `WIPE_TEST_DATA_IN_${target.toUpperCase()}`;
  const actual = process.env.STAGING_CLEANUP_CONFIRM;
  if (actual !== expected) {
    throw new Error(`--apply requires STAGING_CLEANUP_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

// A second, independent phrase — deliberately harder to copy-paste from a
// script or muscle memory than a single all-caps token — proportionate to
// how much more destructive this script is than bootstrap-admin/
// sync-system-roles (those only ever create/reconcile rows; this one
// permanently deletes them).
const REQUIRED_CONFIRM_PHRASE = 'ELIMINAR DATOS DE PRUEBA STAGING';

function requirePhraseConfirmation(): void {
  const actual = process.env.STAGING_CLEANUP_CONFIRM_PHRASE;
  if (actual !== REQUIRED_CONFIRM_PHRASE) {
    throw new Error(`--apply requires STAGING_CLEANUP_CONFIRM_PHRASE="${REQUIRED_CONFIRM_PHRASE}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

type BackupDecision = 'backup_acknowledged' | 'proceed_without_backup';

const REQUIRED_NO_BACKUP_PHRASE = 'ACEPTO ELIMINAR DEFINITIVAMENTE LOS DATOS DE STAGING SIN RESPALDO';

const DESTRUCTIVE_NO_BACKUP_WARNING =
  'Se ejecutará una eliminación permanente en Neon staging sin respaldo. Los datos no podrán recuperarse.';

// This script has no way to trigger a Neon backup/branch snapshot itself
// (no database or Neon API credentials are ever read for that purpose) —
// both paths below are human-asserted promises, not verifications, exactly
// like the database-branch check above. Neither is a "default": exactly
// one of the two must be set to the literal string "true", never both,
// never neither, and no other value silently falls through as "not set" —
// a typo here fails loudly instead of quietly picking a branch. See
// docs/staging-cleanup-procedure.md §"Backup previo" for the console steps
// STAGING_CLEANUP_BACKUP_ACKNOWLEDGED stands in for.
function resolveBackupDecision(): BackupDecision {
  const backupRaw = process.env.STAGING_CLEANUP_BACKUP_ACKNOWLEDGED;
  const noBackupRaw = process.env.STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP;
  const backupSelected = backupRaw === 'true';
  const noBackupSelected = noBackupRaw === 'true';

  if (backupRaw !== undefined && !backupSelected) {
    throw new Error(`STAGING_CLEANUP_BACKUP_ACKNOWLEDGED must be exactly "true" if set (got "${backupRaw}").`);
  }
  if (noBackupRaw !== undefined && !noBackupSelected) {
    throw new Error(`STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP must be exactly "true" if set (got "${noBackupRaw}").`);
  }
  if (backupSelected && noBackupSelected) {
    throw new Error(
      'Set exactly ONE of STAGING_CLEANUP_BACKUP_ACKNOWLEDGED="true" or STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP="true" — never both.',
    );
  }
  if (!backupSelected && !noBackupSelected) {
    throw new Error(
      '--apply requires an explicit backup decision: STAGING_CLEANUP_BACKUP_ACKNOWLEDGED="true" (a Neon backup/branch snapshot was created by hand) or STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP="true" (explicitly proceeding without one, staging data cannot be recovered).',
    );
  }

  if (noBackupSelected) {
    const phrase = process.env.STAGING_CLEANUP_NO_BACKUP_PHRASE;
    if (phrase !== REQUIRED_NO_BACKUP_PHRASE) {
      throw new Error(
        `STAGING_CLEANUP_PROCEED_WITHOUT_BACKUP="true" also requires STAGING_CLEANUP_NO_BACKUP_PHRASE="${REQUIRED_NO_BACKUP_PHRASE}" (got ${phrase ? 'a different value' : 'nothing'}).`,
      );
    }
    return 'proceed_without_backup';
  }

  return 'backup_acknowledged';
}

// Human-asserted, not independently verifiable — see the file header
// comment for the full rationale. Compared byte-for-byte against the id
// `--check` printed; a mismatch means either a different `--check` run was
// used, or no `--check` was run against this exact database at all.
function requireExpectedOrganizationId(): string {
  return requireEnv('STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID');
}

async function loadKeptUser(
  client: PrismaClient | Prisma.TransactionClient,
  email: string,
  roleName: string,
): Promise<KeptUser | null> {
  const user = await client.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, organizationId: true, status: true, deletedAt: true },
  });
  if (!user) return null;

  const roleAssignment = await client.userRole.findFirst({
    where: { userId: user.id, role: { name: roleName, organizationId: user.organizationId } },
  });

  return { ...user, hasExpectedRole: roleAssignment !== null };
}

// Every table below is scoped to `organizationId` — either directly (most
// tables) or, for the three tables with no organizationId column of their
// own (SignatureVersion, SequenceStepVersion, SequenceTemplateVersion), via
// a relation filter to their immediate parent. Order matches the deletion
// order documented in the file header exactly, so `--check`'s report reads
// top-to-bottom in the same sequence `--apply` will execute.
function buildTableCountQueries(client: PrismaClient | Prisma.TransactionClient, organizationId: string) {
  return [
    { table: 'conversationReadState', count: () => client.conversationReadState.count({ where: { organizationId } }) },
    { table: 'conversationTagAssignment', count: () => client.conversationTagAssignment.count({ where: { organizationId } }) },
    { table: 'conversationNote', count: () => client.conversationNote.count({ where: { organizationId } }) },
    { table: 'conversationMessage', count: () => client.conversationMessage.count({ where: { organizationId } }) },
    { table: 'conversation', count: () => client.conversation.count({ where: { organizationId } }) },
    { table: 'conversationTag', count: () => client.conversationTag.count({ where: { organizationId } }) },
    { table: 'scheduledEmail', count: () => client.scheduledEmail.count({ where: { organizationId } }) },
    { table: 'prospectImportRow', count: () => client.prospectImportRow.count({ where: { organizationId } }) },
    { table: 'sequenceStepVersion', count: () => client.sequenceStepVersion.count({ where: { sequenceStep: { organizationId } } }) },
    { table: 'sequenceStep', count: () => client.sequenceStep.count({ where: { organizationId } }) },
    { table: 'sequenceContact', count: () => client.sequenceContact.count({ where: { organizationId } }) },
    { table: 'prospectImport', count: () => client.prospectImport.count({ where: { organizationId } }) },
    { table: 'sequenceImportRow', count: () => client.sequenceImportRow.count({ where: { organizationId } }) },
    { table: 'sequenceImport', count: () => client.sequenceImport.count({ where: { organizationId } }) },
    { table: 'contact', count: () => client.contact.count({ where: { organizationId } }) },
    { table: 'sequenceExecution', count: () => client.sequenceExecution.count({ where: { organizationId } }) },
    { table: 'sequenceTemplateVersion', count: () => client.sequenceTemplateVersion.count({ where: { template: { organizationId } } }) },
    { table: 'sequenceTemplateStep', count: () => client.sequenceTemplateStep.count({ where: { organizationId } }) },
    { table: 'sequenceTemplate', count: () => client.sequenceTemplate.count({ where: { organizationId } }) },
    { table: 'company', count: () => client.company.count({ where: { organizationId } }) },
    { table: 'sequence', count: () => client.sequence.count({ where: { organizationId } }) },
    { table: 'signatureVersion', count: () => client.signatureVersion.count({ where: { signature: { organizationId } } }) },
    { table: 'signature', count: () => client.signature.count({ where: { organizationId } }) },
    { table: 'signatureAsset', count: () => client.signatureAsset.count({ where: { organizationId } }) },
    { table: 'emailBodyAsset', count: () => client.emailBodyAsset.count({ where: { organizationId } }) },
    { table: 'integrationEvent', count: () => client.integrationEvent.count({ where: { organizationId } }) },
    { table: 'integrationCommand', count: () => client.integrationCommand.count({ where: { organizationId } }) },
    { table: 'clientExecutiveAssignment', count: () => client.clientExecutiveAssignment.count({ where: { organizationId } }) },
    { table: 'mailboxAssignment', count: () => client.mailboxAssignment.count({ where: { organizationId } }) },
    { table: 'mailboxConnectionTest', count: () => client.mailboxConnectionTest.count({ where: { organizationId } }) },
    { table: 'mailbox', count: () => client.mailbox.count({ where: { organizationId } }) },
    { table: 'domain', count: () => client.domain.count({ where: { organizationId } }) },
    { table: 'managedClient', count: () => client.managedClient.count({ where: { organizationId } }) },
    { table: 'variable', count: () => client.variable.count({ where: { organizationId } }) },
    { table: 'template', count: () => client.template.count({ where: { organizationId } }) },
  ] as const;
}

async function diagnose(client: PrismaClient | Prisma.TransactionClient, config: CleanupConfig): Promise<Diagnosis> {
  const adminUser = await loadKeptUser(client, config.keepAdminEmail, ADMIN_ROLE_NAME);
  const executiveUser = await loadKeptUser(client, config.keepExecutiveEmail, EXECUTIVE_ROLE_NAME);

  const reasons: string[] = [];
  if (!adminUser) reasons.push(`No user found with email "${config.keepAdminEmail}" — refusing to run without a confirmed account to preserve.`);
  if (!executiveUser) reasons.push(`No user found with email "${config.keepExecutiveEmail}" — refusing to run without a confirmed account to preserve.`);

  if (adminUser?.deletedAt) reasons.push(`"${config.keepAdminEmail}" is soft-deleted (deletedAt=${adminUser.deletedAt.toISOString()}) — resolve this manually first.`);
  if (executiveUser?.deletedAt) reasons.push(`"${config.keepExecutiveEmail}" is soft-deleted (deletedAt=${executiveUser.deletedAt.toISOString()}) — resolve this manually first.`);

  if (adminUser && executiveUser && adminUser.organizationId !== executiveUser.organizationId) {
    reasons.push(
      `"${config.keepAdminEmail}" (org ${adminUser.organizationId}) and "${config.keepExecutiveEmail}" (org ${executiveUser.organizationId}) belong to different organizations — refusing to guess which one to clean.`,
    );
  }

  if (adminUser && !adminUser.hasExpectedRole) {
    reasons.push(`"${config.keepAdminEmail}" does not currently hold the ${ADMIN_ROLE_NAME} role — run prisma:sync-system-roles first, this script never assigns roles.`);
  }
  if (executiveUser && !executiveUser.hasExpectedRole) {
    reasons.push(`"${config.keepExecutiveEmail}" does not currently hold the ${EXECUTIVE_ROLE_NAME} role — run prisma:sync-system-roles first, this script never assigns roles.`);
  }

  if (reasons.length > 0) {
    return {
      organizationId: null,
      organizationName: null,
      adminUser,
      executiveUser,
      otherUsersToDelete: [],
      mailboxEmailsToDelete: [],
      tableCounts: [],
      auditLogCountPreserved: 0,
      result: 'BLOCKED',
      reasons,
    };
  }

  const organizationId = adminUser!.organizationId;
  const organization = await client.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

  const otherUsersToDelete = await client.user.findMany({
    where: { organizationId, id: { notIn: [adminUser!.id, executiveUser!.id] } },
    select: { id: true, email: true },
  });

  const mailboxes = await client.mailbox.findMany({ where: { organizationId }, select: { email: true } });

  const tableCountQueries = buildTableCountQueries(client, organizationId);
  const tableCounts: TableCount[] = [];
  for (const query of tableCountQueries) {
    tableCounts.push({ table: query.table, count: await query.count() });
  }

  const auditLogCountPreserved = await client.auditLog.count({ where: { organizationId } });

  const totalRowsToDelete = tableCounts.reduce((sum, t) => sum + t.count, 0) + otherUsersToDelete.length;
  const result: ProjectedResult = totalRowsToDelete === 0 ? 'NO_CHANGES' : 'READY';
  if (result === 'NO_CHANGES') {
    reasons.push('Every table is already empty for this organization except the two kept users — nothing to do.');
  } else {
    reasons.push(`${totalRowsToDelete} row(s) across ${tableCounts.filter((t) => t.count > 0).length + (otherUsersToDelete.length > 0 ? 1 : 0)} table(s) will be permanently deleted.`);
  }

  return {
    organizationId,
    organizationName: organization?.name ?? null,
    adminUser,
    executiveUser,
    otherUsersToDelete,
    mailboxEmailsToDelete: mailboxes.map((m) => m.email),
    tableCounts,
    auditLogCountPreserved,
    result,
    reasons,
  };
}

function printDiagnosis(config: CleanupConfig, diagnosis: Diagnosis): void {
  console.log('=== cleanup-staging-test-data --check (read-only) ===');
  console.log(`Target: ${config.target}`);
  console.log(`Declared database branch (human-asserted, not independently verified): ${config.databaseBranch}`);
  console.log(`\nAccounts to KEEP:`);
  console.log(`  ADMIN:      ${config.keepAdminEmail} -> ${diagnosis.adminUser ? `${diagnosis.adminUser.id} (role OK: ${diagnosis.adminUser.hasExpectedRole})` : 'NOT FOUND'}`);
  console.log(`  EXECUTIVE:  ${config.keepExecutiveEmail} -> ${diagnosis.executiveUser ? `${diagnosis.executiveUser.id} (role OK: ${diagnosis.executiveUser.hasExpectedRole})` : 'NOT FOUND'}`);

  if (diagnosis.organizationId) {
    console.log(`\nOrganization in scope: "${diagnosis.organizationName}" (${diagnosis.organizationId})`);
    console.log(`Other users to be permanently deleted: ${diagnosis.otherUsersToDelete.length}`);
    diagnosis.otherUsersToDelete.forEach((u) => console.log(`  - ${u.email} (${u.id})`));
    console.log(`\nMailboxes to be deleted (their firmas/{correo}/ folder will also be purged): ${diagnosis.mailboxEmailsToDelete.length}`);
    diagnosis.mailboxEmailsToDelete.forEach((email) => console.log(`  - ${email}`));
    console.log(`\nRow counts to delete, per table (deletion order):`);
    diagnosis.tableCounts.forEach((t) => console.log(`  ${t.table.padEnd(28)} ${t.count}`));
    console.log(`\nUNTOUCHED (never deleted by this script):`);
    console.log('  organizations, roles, permissions, role_permissions, _prisma_migrations');
    console.log(`  users_roles/users for the 2 kept accounts above`);
    console.log(`  audit_logs — PRESERVED deliberately (${diagnosis.auditLogCountPreserved} row(s) for this organization); see file header comment for why.`);
  }

  console.log(`\nProjected result: ${diagnosis.result}`);
  console.log('Reasons:');
  diagnosis.reasons.forEach((reason) => console.log(`  - ${reason}`));
}

async function runCheck(client: PrismaClient, config: CleanupConfig): Promise<Diagnosis> {
  const diagnosis = await diagnose(client, config);
  printDiagnosis(config, diagnosis);
  if (diagnosis.result === 'BLOCKED') {
    process.exitCode = 1;
  }
  return diagnosis;
}

interface ApplyResult {
  diagnosis: Diagnosis;
  deletionCounts: Record<string, number>;
  deletedUserCount: number;
  assetCleanup: AssetCleanupReport;
  backupDecision: BackupDecision;
}

interface AssetCleanupReport {
  mode: 'r2' | 'simulated' | 'skipped';
  signatureFoldersPurged: string[];
  signatureFoldersFailed: { email: string; error: string }[];
  emailBodyPurged: boolean;
  emailBodyError: string | null;
}

// Best-effort, post-commit purge — mirrors DeleteMailboxUseCase's own
// post-commit cleanup pattern exactly (a fallible external/filesystem call
// is never allowed to hold open, or roll back, a Postgres transaction).
// Runs against whichever storage mode this process's own env is configured
// for (SIGNATURE_ASSET_STORAGE_MODE) — the SAME variable the running API
// reads, so pointing this script's env at the same values as the target
// environment's API process is what makes this cleanup match reality.
async function purgeAssets(organizationId: string, mailboxEmails: string[]): Promise<AssetCleanupReport> {
  const mode = process.env.SIGNATURE_ASSET_STORAGE_MODE === 'r2' ? 'r2' : 'simulated';
  const signaturePrefixRoot = process.env.R2_SIGNATURE_PREFIX || 'firmas';
  const emailBodyPrefixRoot = process.env.R2_EMAIL_BODY_PREFIX || 'email-body';

  const report: AssetCleanupReport = {
    mode,
    signatureFoldersPurged: [],
    signatureFoldersFailed: [],
    emailBodyPurged: false,
    emailBodyError: null,
  };

  if (mode === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      console.warn('SIGNATURE_ASSET_STORAGE_MODE=r2 but R2 credentials are not fully set in this shell — skipping asset cleanup. Purge manually via the Cloudflare console or re-run with the credentials set.');
      return { ...report, mode: 'skipped' };
    }

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    const deleteByPrefix = async (prefix: string): Promise<number> => {
      let deleted = 0;
      let continuationToken: string | undefined;
      do {
        const listed = await client.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, ContinuationToken: continuationToken }));
        const keys = (listed.Contents ?? []).map((o: { Key?: string }) => o.Key).filter((k: string | undefined): k is string => Boolean(k));
        for (let i = 0; i < keys.length; i += 1000) {
          const batch = keys.slice(i, i + 1000);
          if (batch.length === 0) continue;
          await client.send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: batch.map((key: string) => ({ Key: key })), Quiet: true } }));
          deleted += batch.length;
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
      return deleted;
    };

    for (const email of mailboxEmails) {
      try {
        const normalized = normalizeMailboxEmailForStorageKey(email);
        const prefix = buildSignatureFolderPrefix(signaturePrefixRoot, normalized);
        await deleteByPrefix(prefix);
        report.signatureFoldersPurged.push(email);
      } catch (error) {
        report.signatureFoldersFailed.push({ email, error: error instanceof Error ? error.message : String(error) });
      }
    }

    try {
      await deleteByPrefix(`${emailBodyPrefixRoot.replace(/^\/+|\/+$/g, '')}/${organizationId}/`);
      report.emailBodyPurged = true;
    } catch (error) {
      report.emailBodyError = error instanceof Error ? error.message : String(error);
    }

    return report;
  }

  // simulated mode — local disk, mirrors SimulatedSignatureAssetStorageAdapter's own uploadsRoot convention exactly.
  const uploadsRoot = join(process.cwd(), 'uploads');
  for (const email of mailboxEmails) {
    try {
      const normalized = normalizeMailboxEmailForStorageKey(email);
      const prefix = buildSignatureFolderPrefix(signaturePrefixRoot, normalized);
      const dirPath = join(uploadsRoot, prefix);
      if (existsSync(dirPath)) {
        await rm(dirPath, { recursive: true, force: true });
      }
      report.signatureFoldersPurged.push(email);
    } catch (error) {
      report.signatureFoldersFailed.push({ email, error: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    const emailBodyDir = join(uploadsRoot, emailBodyPrefixRoot.replace(/^\/+|\/+$/g, ''), organizationId);
    if (existsSync(emailBodyDir)) {
      await rm(emailBodyDir, { recursive: true, force: true });
    }
    report.emailBodyPurged = true;
  } catch (error) {
    report.emailBodyError = error instanceof Error ? error.message : String(error);
  }

  return report;
}

async function runApply(client: PrismaClient, config: CleanupConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  requirePhraseConfirmation();
  const backupDecision = resolveBackupDecision();
  const expectedOrganizationId = requireExpectedOrganizationId();
  if (config.target.toLowerCase() === 'production') {
    throw new Error('This script refuses to run against STAGING_CLEANUP_TARGET=production, unconditionally. There is no confirmation value that overrides this.');
  }

  if (backupDecision === 'proceed_without_backup') {
    console.warn(DESTRUCTIVE_NO_BACKUP_WARNING);
  }

  let finalDiagnosis!: Diagnosis;
  const deletionCounts: Record<string, number> = {};
  let deletedUserCount = 0;
  let organizationIdForAssetCleanup = '';
  let mailboxEmailsForAssetCleanup: string[] = [];

  await client.$transaction(
    async (tx) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another cleanup-staging-test-data --apply run holds the lock — aborting to avoid a race.');
      }

      const diagnosis = await diagnose(tx, config);
      finalDiagnosis = diagnosis;
      if (diagnosis.result === 'BLOCKED') {
        throw new Error(`Blocked: ${diagnosis.reasons.join(' ')}`);
      }
      if (diagnosis.organizationId !== expectedOrganizationId) {
        throw new Error(
          `STAGING_CLEANUP_EXPECTED_ORGANIZATION_ID ("${expectedOrganizationId}") does not match the organization resolved from the two kept accounts ("${diagnosis.organizationId}"). Run --check again and use the organization id it reports.`,
        );
      }
      if (diagnosis.result === 'NO_CHANGES') {
        // Idempotency: a second run converges here and writes nothing further.
        return;
      }

      const organizationId = diagnosis.organizationId as string;
      organizationIdForAssetCleanup = organizationId;
      mailboxEmailsForAssetCleanup = diagnosis.mailboxEmailsToDelete;
      const keepUserIds = [diagnosis.adminUser!.id, diagnosis.executiveUser!.id];
      const userIdsToDelete = diagnosis.otherUsersToDelete.map((u) => u.id);

      const record = async (table: string, promise: Promise<{ count: number }>): Promise<void> => {
        const result = await promise;
        deletionCounts[table] = result.count;
      };

      await record('conversationReadState', tx.conversationReadState.deleteMany({ where: { organizationId } }));
      await record('conversationTagAssignment', tx.conversationTagAssignment.deleteMany({ where: { organizationId } }));
      await record('conversationNote', tx.conversationNote.deleteMany({ where: { organizationId } }));
      await record('conversationMessage', tx.conversationMessage.deleteMany({ where: { organizationId } }));
      await record('conversation', tx.conversation.deleteMany({ where: { organizationId } }));
      await record('conversationTag', tx.conversationTag.deleteMany({ where: { organizationId } }));
      await record('scheduledEmail', tx.scheduledEmail.deleteMany({ where: { organizationId } }));
      await record('prospectImportRow', tx.prospectImportRow.deleteMany({ where: { organizationId } }));
      await record('sequenceStepVersion', tx.sequenceStepVersion.deleteMany({ where: { sequenceStep: { organizationId } } }));
      await record('sequenceStep', tx.sequenceStep.deleteMany({ where: { organizationId } }));
      await record('sequenceContact', tx.sequenceContact.deleteMany({ where: { organizationId } }));
      await record('prospectImport', tx.prospectImport.deleteMany({ where: { organizationId } }));
      await record('sequenceImportRow', tx.sequenceImportRow.deleteMany({ where: { organizationId } }));
      await record('sequenceImport', tx.sequenceImport.deleteMany({ where: { organizationId } }));
      await record('contact', tx.contact.deleteMany({ where: { organizationId } }));
      await record('sequenceExecution', tx.sequenceExecution.deleteMany({ where: { organizationId } }));
      await record('sequenceTemplateVersion', tx.sequenceTemplateVersion.deleteMany({ where: { template: { organizationId } } }));
      await record('sequenceTemplateStep', tx.sequenceTemplateStep.deleteMany({ where: { organizationId } }));
      await record('sequenceTemplate', tx.sequenceTemplate.deleteMany({ where: { organizationId } }));
      await record('company', tx.company.deleteMany({ where: { organizationId } }));
      await record('sequence', tx.sequence.deleteMany({ where: { organizationId } }));
      await record('signatureVersion', tx.signatureVersion.deleteMany({ where: { signature: { organizationId } } }));
      await record('signature', tx.signature.deleteMany({ where: { organizationId } }));
      await record('signatureAsset', tx.signatureAsset.deleteMany({ where: { organizationId } }));
      await record('emailBodyAsset', tx.emailBodyAsset.deleteMany({ where: { organizationId } }));
      await record('integrationEvent', tx.integrationEvent.deleteMany({ where: { organizationId } }));
      await record('integrationCommand', tx.integrationCommand.deleteMany({ where: { organizationId } }));
      await record('clientExecutiveAssignment', tx.clientExecutiveAssignment.deleteMany({ where: { organizationId } }));
      await record('mailboxAssignment', tx.mailboxAssignment.deleteMany({ where: { organizationId } }));
      await record('mailboxConnectionTest', tx.mailboxConnectionTest.deleteMany({ where: { organizationId } }));
      await record('mailbox', tx.mailbox.deleteMany({ where: { organizationId } }));
      await record('domain', tx.domain.deleteMany({ where: { organizationId } }));
      await record('managedClient', tx.managedClient.deleteMany({ where: { organizationId } }));
      await record('variable', tx.variable.deleteMany({ where: { organizationId } }));
      await record('template', tx.template.deleteMany({ where: { organizationId } }));
      await record('userRole', tx.userRole.deleteMany({ where: { userId: { in: userIdsToDelete } } }));
      await record('user', tx.user.deleteMany({ where: { id: { in: userIdsToDelete } } }));
      deletedUserCount = userIdsToDelete.length;

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: null,
          action: 'staging_cleanup.apply',
          entityType: 'Organization',
          entityId: organizationId,
          metadata: {
            target: config.target,
            keptUserIds: keepUserIds,
            deletedUserCount,
            deletionCounts,
            backupDecision,
          },
        },
      });
    },
    { timeout: 60_000 },
  );

  const assetCleanup: AssetCleanupReport =
    finalDiagnosis.result === 'NO_CHANGES'
      ? { mode: 'skipped', signatureFoldersPurged: [], signatureFoldersFailed: [], emailBodyPurged: false, emailBodyError: null }
      : await purgeAssets(organizationIdForAssetCleanup, mailboxEmailsForAssetCleanup);

  return { diagnosis: finalDiagnosis, deletionCounts, deletedUserCount, assetCleanup, backupDecision };
}

function printApplyResult(config: CleanupConfig, result: ApplyResult): void {
  console.log(`=== cleanup-staging-test-data --apply (${config.target}) ===`);
  console.log(`Backup decision: ${result.backupDecision}`);
  if (result.diagnosis.result === 'NO_CHANGES') {
    console.log('Nothing to do — the organization was already clean (idempotent no-op).');
    return;
  }
  console.log(`Organization: "${result.diagnosis.organizationName}" (${result.diagnosis.organizationId})`);
  console.log(`Users permanently deleted: ${result.deletedUserCount}`);
  console.log('Rows deleted, per table:');
  Object.entries(result.deletionCounts).forEach(([table, count]) => console.log(`  ${table.padEnd(28)} ${count}`));
  console.log(`\nAsset cleanup (${result.assetCleanup.mode}):`);
  console.log(`  Signature folders purged: ${result.assetCleanup.signatureFoldersPurged.length}`);
  if (result.assetCleanup.signatureFoldersFailed.length > 0) {
    console.log(`  Signature folders FAILED to purge (data already deleted from Postgres — purge these manually):`);
    result.assetCleanup.signatureFoldersFailed.forEach((f) => console.log(`    - ${f.email}: ${f.error}`));
  }
  console.log(`  Email-body assets purged: ${result.assetCleanup.emailBodyPurged}`);
  if (result.assetCleanup.emailBodyError) {
    console.log(`  Email-body purge FAILED: ${result.assetCleanup.emailBodyError} — purge manually.`);
  }
  console.log(`\nPreserved: organization, roles/permissions, the 2 kept users, and ${result.diagnosis.auditLogCountPreserved} audit_log row(s) for this organization.`);
  console.log('Re-run with --check to confirm a second run now reports NO_CHANGES (idempotency).');
}

async function main(): Promise<void> {
  const mode: Mode = parseMode(process.argv.slice(2));
  const config = loadConfig();
  requireDatabaseUrlPresent();
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

// Guarded so importing this module for tests never opens a PrismaClient.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  CLEANUP_LOCK_KEY,
  DESTRUCTIVE_NO_BACKUP_WARNING,
  REQUIRED_CONFIRM_PHRASE,
  REQUIRED_NO_BACKUP_PHRASE,
  buildTableCountQueries,
  diagnose,
  loadConfig,
  printApplyResult,
  printDiagnosis,
  purgeAssets,
  requireConfirmation,
  requireDatabaseUrlPresent,
  requireExpectedOrganizationId,
  requirePhraseConfirmation,
  resolveBackupDecision,
  runApply,
  runCheck,
};
export type {
  ApplyResult,
  AssetCleanupReport,
  BackupDecision,
  CleanupConfig,
  Diagnosis,
  KeptUser,
  OtherUser,
  ProjectedResult,
  TableCount,
};
