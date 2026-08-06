/**
 * One-off, auditable, idempotent hard-delete of a SINGLE mailbox and every
 * row that has a real foreign key pointing at it, so the same email can be
 * linked again from scratch (`Mailbox.@@unique([organizationId, email])`
 * has no exception for a REVOKED or soft-deleted row — the row must
 * actually be gone for `POST /mailboxes/link` to succeed a second time).
 *
 * Distinct from prisma/cleanup-staging-test-data.ts: that script wipes an
 * entire organization's operational data down to two kept users. This one
 * touches exactly one Mailbox row (resolved by email) and its own direct
 * dependents — every other mailbox, every other client/domain, and every
 * non-mailbox-scoped table (Organization, Role, Permission, User,
 * ManagedClient, Domain, Template, Variable, AuditLog, EmailBodyAsset) are
 * never touched. Shares the same conventions as its three siblings
 * (bootstrap-admin.ts, sync-system-roles.ts, cleanup-staging-test-data.ts):
 * `--check`/`--apply` modes, an explicit `*_CONFIRM` phrase, an
 * unconditional refusal on TARGET=production, a transaction-scoped
 * `pg_advisory_xact_lock`, and a single transaction for every write.
 *
 * What this script deletes, in FK-safe order (children before parents —
 * verified against every `@relation` pointing at Mailbox in
 * prisma/schema.prisma, plus the one level of grandchildren each of those
 * tables itself owns):
 *   integration_commands/integration_events (aggregateType=EXECUTION, aggregateId = this mailbox's SequenceExecution ids)
 *   -> integration_commands/integration_events (aggregateType=TEMPLATE, aggregateId = this mailbox's SequenceTemplateVersion ids)
 *   -> integration_commands/integration_events (aggregateType=MAILBOX, aggregateId = this mailbox's own id)
 *   -> prospect_import_rows -> prospect_imports (via this mailbox's SequenceExecution.prospectImportId)
 *   -> sequence_executions
 *   -> sequence_template_steps -> sequence_template_versions -> sequence_templates
 *   -> signature_versions -> signature_assets -> signatures
 *   -> scheduled_emails
 *   -> sequence_import_rows -> sequence_contacts (via sourceImportId) -> sequence_imports  [legacy "Secuencias" architecture]
 *   -> sequence_step_versions -> sequence_steps -> sequences (legacy, only if this mailbox was ever a legacy sender)
 *   -> conversation_read_states/conversation_tag_assignments/conversation_notes/conversation_messages -> conversations
 *   -> simulation_conversation_batches
 *   -> mailbox_connection_tests -> mailbox_assignments
 *   -> the mailbox row itself
 *
 * `sequence_contacts.assignedMailboxId` is deliberately NOT in this list —
 * it is a plain denormalized column with no `@relation`/FK constraint (see
 * schema.prisma), so it can never block this delete; leaving a few stale
 * ids there is a pre-existing, informational-only quirk, not something this
 * script introduces.
 *
 * What this script never does (by design):
 *   - touch a DIFFERENT mailbox, its organization, its client/domain, or
 *     any row not scoped to THIS mailbox's id (or a direct child id
 *     resolved from it)
 *   - touch Organization, Role, Permission, RolePermission, User, UserRole,
 *     ManagedClient, Domain, Template, Variable, AuditLog, EmailBodyAsset,
 *     or `_prisma_migrations`
 *   - purge the mailbox's R2 signature-asset objects itself (best-effort,
 *     separate, manual step — this script only removes the DB rows;
 *     purging Cloudflare R2 requires credentials this script never reads)
 *   - run with CLEANUP_MAILBOX_TARGET anything other than the literal
 *     string "staging" — unconditionally, no confirmation value overrides
 *     this
 *   - run with DATABASE_URL unset or empty
 *   - print a credential, connection string, or any secret column
 *     (imap/smtp ciphertext, executionTokenCiphertext) of any kind
 *
 * `--apply` also requires CLEANUP_MAILBOX_EXPECTED_ID — the mailbox id
 * printed by a `--check` run against this same database — for the same
 * reason sync-system-roles/cleanup-staging-test-data require their own
 * "expected id" variable: it is the only thing that ties a `--check` run to
 * a later `--apply` run.
 *
 * Usage:
 *   CLEANUP_MAILBOX_TARGET=staging \
 *   CLEANUP_MAILBOX_DATABASE_BRANCH=staging \
 *   CLEANUP_MAILBOX_EMAIL=ventas@empresademostracion.cl \
 *   npm run prisma:cleanup-single-mailbox -- --check
 *
 *   CLEANUP_MAILBOX_TARGET=staging \
 *   CLEANUP_MAILBOX_DATABASE_BRANCH=staging \
 *   CLEANUP_MAILBOX_EMAIL=ventas@empresademostracion.cl \
 *   CLEANUP_MAILBOX_EXPECTED_ID=<id printed by --check> \
 *   CLEANUP_MAILBOX_CONFIRM=DELETE_MAILBOX_IN_STAGING \
 *   CLEANUP_MAILBOX_CONFIRM_PHRASE="ELIMINAR CUENTA DE DEMOSTRACION EN STAGING" \
 *   npm run prisma:cleanup-single-mailbox -- --apply
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { parseMode, requireEnv } from './bootstrap-admin';

// One higher than cleanup-staging-test-data's (891234567893) — grepped
// `pg_advisory` across the repo before choosing it; none of the four
// scripts can ever contend for the same lock.
const CLEANUP_MAILBOX_LOCK_KEY = 891234567894;

type Mode = 'check' | 'apply';
type ProjectedResult = 'READY' | 'NO_CHANGES' | 'BLOCKED';

interface CleanupMailboxConfig {
  target: string;
  databaseBranch: string;
  email: string;
}

interface TableCount {
  table: string;
  count: number;
}

interface Diagnosis {
  mailboxId: string | null;
  organizationId: string | null;
  linkStatus: string | null;
  deletedAt: Date | null;
  tableCounts: TableCount[];
  result: ProjectedResult;
  reasons: string[];
}

function loadConfig(): CleanupMailboxConfig {
  const target = requireEnv('CLEANUP_MAILBOX_TARGET');
  const databaseBranch = requireEnv('CLEANUP_MAILBOX_DATABASE_BRANCH');
  const email = requireEnv('CLEANUP_MAILBOX_EMAIL').toLowerCase();

  if (target.toLowerCase() !== 'staging') {
    throw new Error(`CLEANUP_MAILBOX_TARGET must be exactly "staging" (got "${target}").`);
  }
  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `CLEANUP_MAILBOX_DATABASE_BRANCH ("${databaseBranch}") must equal CLEANUP_MAILBOX_TARGET ("${target}") — refusing to continue on a mismatch.`,
    );
  }
  return { target, databaseBranch, email };
}

function requireDatabaseUrlPresent(): void {
  const value = process.env.DATABASE_URL;
  if (!value || value.trim().length === 0) {
    throw new Error('DATABASE_URL must be set and non-empty.');
  }
}

function requireConfirmation(target: string): void {
  const expected = `DELETE_MAILBOX_IN_${target.toUpperCase()}`;
  const actual = process.env.CLEANUP_MAILBOX_CONFIRM;
  if (actual !== expected) {
    throw new Error(`--apply requires CLEANUP_MAILBOX_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

const REQUIRED_CONFIRM_PHRASE = 'ELIMINAR CUENTA DE DEMOSTRACION EN STAGING';

function requirePhraseConfirmation(): void {
  const actual = process.env.CLEANUP_MAILBOX_CONFIRM_PHRASE;
  if (actual !== REQUIRED_CONFIRM_PHRASE) {
    throw new Error(`--apply requires CLEANUP_MAILBOX_CONFIRM_PHRASE="${REQUIRED_CONFIRM_PHRASE}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

function requireExpectedMailboxId(): string {
  return requireEnv('CLEANUP_MAILBOX_EXPECTED_ID');
}

interface ResolvedIds {
  mailboxId: string;
  organizationId: string;
  linkStatus: string;
  deletedAt: Date | null;
  executionIds: string[];
  prospectImportIds: string[];
  templateIds: string[];
  templateVersionIds: string[];
  signatureId: string | null;
  conversationIds: string[];
  legacySequenceIds: string[];
  legacyImportIds: string[];
}

async function resolveIds(client: PrismaClient | Prisma.TransactionClient, email: string): Promise<ResolvedIds | null> {
  const mailbox = await client.mailbox.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (!mailbox) return null;

  const mailboxId = mailbox.id;
  const executions = await client.sequenceExecution.findMany({ where: { mailboxId }, select: { id: true } });
  const executionIds = executions.map((e) => e.id);
  // ProspectImport.executionId is the REAL, RESTRICT-enforced FK
  // (`prospect_imports_executionId_fkey`) — SequenceExecution.prospectImportId
  // is only a denormalized mirror with no `@relation` of its own, so it must
  // never be used to resolve which ProspectImport blocks deleting an execution.
  const prospectImports =
    executionIds.length > 0 ? await client.prospectImport.findMany({ where: { executionId: { in: executionIds } }, select: { id: true } }) : [];
  const templates = await client.sequenceTemplate.findMany({ where: { mailboxId }, select: { id: true } });
  const templateIds = templates.map((t) => t.id);
  const templateVersions =
    templateIds.length > 0 ? await client.sequenceTemplateVersion.findMany({ where: { templateId: { in: templateIds } }, select: { id: true } }) : [];
  const signature = await client.signature.findUnique({ where: { mailboxId } });
  const conversations = await client.conversation.findMany({ where: { mailboxId }, select: { id: true } });
  const legacySequences = await client.sequence.findMany({ where: { mailboxId }, select: { id: true } });
  const legacyImports = await client.sequenceImport.findMany({ where: { mailboxId }, select: { id: true } });

  return {
    mailboxId,
    organizationId: mailbox.organizationId,
    linkStatus: mailbox.linkStatus,
    deletedAt: mailbox.deletedAt,
    executionIds,
    prospectImportIds: prospectImports.map((p) => p.id),
    templateIds,
    templateVersionIds: templateVersions.map((v) => v.id),
    signatureId: signature?.id ?? null,
    conversationIds: conversations.map((c) => c.id),
    legacySequenceIds: legacySequences.map((s) => s.id),
    legacyImportIds: legacyImports.map((i) => i.id),
  };
}

async function countDependents(client: PrismaClient | Prisma.TransactionClient, ids: ResolvedIds): Promise<TableCount[]> {
  const { mailboxId, executionIds, prospectImportIds, templateIds, templateVersionIds, signatureId, conversationIds, legacySequenceIds, legacyImportIds } = ids;

  const counts: TableCount[] = [];
  const push = async (table: string, count: Promise<number>): Promise<void> => {
    counts.push({ table, count: await count });
  };

  await push(
    'integrationCommand(EXECUTION)',
    executionIds.length > 0 ? client.integrationCommand.count({ where: { aggregateType: 'EXECUTION', aggregateId: { in: executionIds } } }) : Promise.resolve(0),
  );
  await push(
    'integrationEvent(EXECUTION)',
    executionIds.length > 0 ? client.integrationEvent.count({ where: { aggregateType: 'EXECUTION', aggregateId: { in: executionIds } } }) : Promise.resolve(0),
  );
  await push(
    'integrationCommand(TEMPLATE)',
    templateVersionIds.length > 0
      ? client.integrationCommand.count({ where: { aggregateType: 'TEMPLATE', aggregateId: { in: templateVersionIds } } })
      : Promise.resolve(0),
  );
  await push(
    'integrationEvent(TEMPLATE)',
    templateVersionIds.length > 0
      ? client.integrationEvent.count({ where: { aggregateType: 'TEMPLATE', aggregateId: { in: templateVersionIds } } })
      : Promise.resolve(0),
  );
  await push('integrationCommand(MAILBOX)', client.integrationCommand.count({ where: { aggregateType: 'MAILBOX', aggregateId: mailboxId } }));
  await push('integrationEvent(MAILBOX)', client.integrationEvent.count({ where: { aggregateType: 'MAILBOX', aggregateId: mailboxId } }));

  await push(
    'prospectImportRow',
    prospectImportIds.length > 0 ? client.prospectImportRow.count({ where: { importId: { in: prospectImportIds } } }) : Promise.resolve(0),
  );
  await push('prospectImport', prospectImportIds.length > 0 ? client.prospectImport.count({ where: { id: { in: prospectImportIds } } }) : Promise.resolve(0));
  await push('sequenceExecution', client.sequenceExecution.count({ where: { mailboxId } }));

  await push('sequenceTemplateStep', templateIds.length > 0 ? client.sequenceTemplateStep.count({ where: { templateId: { in: templateIds } } }) : Promise.resolve(0));
  await push('sequenceTemplateVersion', templateIds.length > 0 ? client.sequenceTemplateVersion.count({ where: { templateId: { in: templateIds } } }) : Promise.resolve(0));
  await push('sequenceTemplate', client.sequenceTemplate.count({ where: { mailboxId } }));

  await push('signatureVersion', signatureId ? client.signatureVersion.count({ where: { signatureId } }) : Promise.resolve(0));
  await push('signatureAsset', client.signatureAsset.count({ where: { mailboxId } }));
  await push('signature', client.signature.count({ where: { mailboxId } }));

  await push('scheduledEmail', client.scheduledEmail.count({ where: { mailboxId } }));

  const legacyImportRows =
    legacyImportIds.length > 0 ? await client.sequenceImportRow.count({ where: { importId: { in: legacyImportIds } } }) : 0;
  const legacySequenceContacts =
    legacyImportIds.length > 0 ? await client.sequenceContact.count({ where: { sourceImportId: { in: legacyImportIds } } }) : 0;
  counts.push({ table: 'sequenceImportRow', count: legacyImportRows });
  counts.push({ table: 'sequenceContact(sourceImport)', count: legacySequenceContacts });
  await push('sequenceImport', client.sequenceImport.count({ where: { mailboxId } }));

  const legacySteps =
    legacySequenceIds.length > 0 ? await client.sequenceStep.count({ where: { sequenceId: { in: legacySequenceIds } } }) : 0;
  counts.push({ table: 'sequenceStep', count: legacySteps });
  const legacyStepRows = legacySequenceIds.length > 0 ? await client.sequenceStep.findMany({ where: { sequenceId: { in: legacySequenceIds } }, select: { id: true } }) : [];
  const legacyStepIds = legacyStepRows.map((s) => s.id);
  const legacyStepVersions =
    legacyStepIds.length > 0 ? await client.sequenceStepVersion.count({ where: { sequenceStepId: { in: legacyStepIds } } }) : 0;
  counts.push({ table: 'sequenceStepVersion', count: legacyStepVersions });
  await push('sequence(legacy)', client.sequence.count({ where: { mailboxId } }));

  const readStates = conversationIds.length > 0 ? await client.conversationReadState.count({ where: { conversationId: { in: conversationIds } } }) : 0;
  const tagAssignments = conversationIds.length > 0 ? await client.conversationTagAssignment.count({ where: { conversationId: { in: conversationIds } } }) : 0;
  const notes = conversationIds.length > 0 ? await client.conversationNote.count({ where: { conversationId: { in: conversationIds } } }) : 0;
  const messagesByMailbox = await client.conversationMessage.count({ where: { mailboxId } });
  counts.push({ table: 'conversationReadState', count: readStates });
  counts.push({ table: 'conversationTagAssignment', count: tagAssignments });
  counts.push({ table: 'conversationNote', count: notes });
  counts.push({ table: 'conversationMessage', count: messagesByMailbox });
  await push('conversation', client.conversation.count({ where: { mailboxId } }));
  await push('simulationConversationBatch', client.simulationConversationBatch.count({ where: { mailboxId } }));

  await push('mailboxConnectionTest', client.mailboxConnectionTest.count({ where: { mailboxId } }));
  await push('mailboxAssignment', client.mailboxAssignment.count({ where: { mailboxId } }));

  return counts;
}

async function diagnose(client: PrismaClient | Prisma.TransactionClient, config: CleanupMailboxConfig): Promise<Diagnosis> {
  const ids = await resolveIds(client, config.email);
  if (!ids) {
    return {
      mailboxId: null,
      organizationId: null,
      linkStatus: null,
      deletedAt: null,
      tableCounts: [],
      result: 'BLOCKED',
      reasons: [`No Mailbox row found for "${config.email}" — nothing to clean up.`],
    };
  }

  const reasons: string[] = [];
  if (ids.linkStatus !== 'REVOKED') {
    reasons.push(
      `This mailbox's linkStatus is "${ids.linkStatus}", not REVOKED — unlink it first via the normal app flow (POST /mailboxes/:id/unlink) before hard-deleting it here. This script never bypasses that safeguard.`,
    );
  }

  const tableCounts = await countDependents(client, ids);
  const totalRows = tableCounts.reduce((sum, t) => sum + t.count, 0);

  if (reasons.length > 0) {
    return { mailboxId: ids.mailboxId, organizationId: ids.organizationId, linkStatus: ids.linkStatus, deletedAt: ids.deletedAt, tableCounts, result: 'BLOCKED', reasons };
  }

  const result: ProjectedResult = 'READY';
  reasons.push(`Mailbox + ${totalRows} dependent row(s) across ${tableCounts.filter((t) => t.count > 0).length} table(s) will be permanently deleted.`);

  return { mailboxId: ids.mailboxId, organizationId: ids.organizationId, linkStatus: ids.linkStatus, deletedAt: ids.deletedAt, tableCounts, result, reasons };
}

function printDiagnosis(config: CleanupMailboxConfig, diagnosis: Diagnosis): void {
  console.log('=== cleanup-single-mailbox --check (read-only) ===');
  console.log(`Target: ${config.target}`);
  console.log(`Declared database branch (human-asserted, not independently verified): ${config.databaseBranch}`);
  console.log(`Email: ${config.email}`);

  if (diagnosis.mailboxId) {
    console.log(`\nMailbox found: ${diagnosis.mailboxId} (organization ${diagnosis.organizationId})`);
    console.log(`  linkStatus: ${diagnosis.linkStatus}`);
    console.log(`  deletedAt: ${diagnosis.deletedAt ? diagnosis.deletedAt.toISOString() : 'null (never soft-deleted)'}`);
    console.log(`\nRow counts to delete, per table (deletion order):`);
    diagnosis.tableCounts.forEach((t) => console.log(`  ${t.table.padEnd(30)} ${t.count}`));
  }

  console.log(`\nUNTOUCHED (never deleted by this script): every other mailbox, its organization, client, domain, users, roles, permissions, audit_logs, email_body_assets, _prisma_migrations.`);
  console.log(`\nProjected result: ${diagnosis.result}`);
  console.log('Reasons:');
  diagnosis.reasons.forEach((reason) => console.log(`  - ${reason}`));
}

async function runCheck(client: PrismaClient, config: CleanupMailboxConfig): Promise<Diagnosis> {
  const diagnosis = await diagnose(client, config);
  printDiagnosis(config, diagnosis);
  if (diagnosis.result === 'BLOCKED') process.exitCode = 1;
  return diagnosis;
}

interface ApplyResult {
  diagnosis: Diagnosis;
  deletionCounts: Record<string, number>;
}

async function runApply(client: PrismaClient, config: CleanupMailboxConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  requirePhraseConfirmation();
  const expectedMailboxId = requireExpectedMailboxId();
  if (config.target.toLowerCase() === 'production') {
    throw new Error('This script refuses to run against CLEANUP_MAILBOX_TARGET=production, unconditionally.');
  }

  let finalDiagnosis!: Diagnosis;
  const deletionCounts: Record<string, number> = {};

  await client.$transaction(
    async (tx) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${CLEANUP_MAILBOX_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another cleanup-single-mailbox --apply run holds the lock — aborting to avoid a race.');
      }

      const ids = await resolveIds(tx, config.email);
      const diagnosis = await diagnose(tx, config);
      finalDiagnosis = diagnosis;
      if (diagnosis.result === 'BLOCKED') {
        throw new Error(`Blocked: ${diagnosis.reasons.join(' ')}`);
      }
      if (diagnosis.mailboxId !== expectedMailboxId) {
        throw new Error(
          `CLEANUP_MAILBOX_EXPECTED_ID ("${expectedMailboxId}") does not match the mailbox resolved from CLEANUP_MAILBOX_EMAIL ("${diagnosis.mailboxId}"). Run --check again and use the id it reports.`,
        );
      }

      const resolved = ids as ResolvedIds;
      const { mailboxId, executionIds, prospectImportIds, templateIds, templateVersionIds, signatureId, conversationIds, legacySequenceIds, legacyImportIds } = resolved;

      const record = async (table: string, promise: Promise<{ count: number }>): Promise<void> => {
        const result = await promise;
        deletionCounts[table] = result.count;
      };

      if (executionIds.length > 0) {
        await record('integrationCommand(EXECUTION)', tx.integrationCommand.deleteMany({ where: { aggregateType: 'EXECUTION', aggregateId: { in: executionIds } } }));
        await record('integrationEvent(EXECUTION)', tx.integrationEvent.deleteMany({ where: { aggregateType: 'EXECUTION', aggregateId: { in: executionIds } } }));
      }
      if (templateVersionIds.length > 0) {
        await record('integrationCommand(TEMPLATE)', tx.integrationCommand.deleteMany({ where: { aggregateType: 'TEMPLATE', aggregateId: { in: templateVersionIds } } }));
        await record('integrationEvent(TEMPLATE)', tx.integrationEvent.deleteMany({ where: { aggregateType: 'TEMPLATE', aggregateId: { in: templateVersionIds } } }));
      }
      await record('integrationCommand(MAILBOX)', tx.integrationCommand.deleteMany({ where: { aggregateType: 'MAILBOX', aggregateId: mailboxId } }));
      await record('integrationEvent(MAILBOX)', tx.integrationEvent.deleteMany({ where: { aggregateType: 'MAILBOX', aggregateId: mailboxId } }));

      if (prospectImportIds.length > 0) {
        await record('prospectImportRow', tx.prospectImportRow.deleteMany({ where: { importId: { in: prospectImportIds } } }));
        await record('prospectImport', tx.prospectImport.deleteMany({ where: { id: { in: prospectImportIds } } }));
      }
      await record('sequenceExecution', tx.sequenceExecution.deleteMany({ where: { mailboxId } }));

      if (templateIds.length > 0) {
        await record('sequenceTemplateStep', tx.sequenceTemplateStep.deleteMany({ where: { templateId: { in: templateIds } } }));
        await record('sequenceTemplateVersion', tx.sequenceTemplateVersion.deleteMany({ where: { templateId: { in: templateIds } } }));
      }
      await record('sequenceTemplate', tx.sequenceTemplate.deleteMany({ where: { mailboxId } }));

      if (signatureId) {
        await record('signatureVersion', tx.signatureVersion.deleteMany({ where: { signatureId } }));
      }
      await record('signatureAsset', tx.signatureAsset.deleteMany({ where: { mailboxId } }));
      await record('signature', tx.signature.deleteMany({ where: { mailboxId } }));

      await record('scheduledEmail', tx.scheduledEmail.deleteMany({ where: { mailboxId } }));

      if (legacyImportIds.length > 0) {
        await record('sequenceImportRow', tx.sequenceImportRow.deleteMany({ where: { importId: { in: legacyImportIds } } }));
        await record('sequenceContact(sourceImport)', tx.sequenceContact.deleteMany({ where: { sourceImportId: { in: legacyImportIds } } }));
      }
      await record('sequenceImport', tx.sequenceImport.deleteMany({ where: { mailboxId } }));

      if (legacySequenceIds.length > 0) {
        const steps = await tx.sequenceStep.findMany({ where: { sequenceId: { in: legacySequenceIds } }, select: { id: true } });
        const stepIds = steps.map((s) => s.id);
        if (stepIds.length > 0) {
          await record('sequenceStepVersion', tx.sequenceStepVersion.deleteMany({ where: { sequenceStepId: { in: stepIds } } }));
        }
        await record('sequenceStep', tx.sequenceStep.deleteMany({ where: { sequenceId: { in: legacySequenceIds } } }));
      }
      await record('sequence(legacy)', tx.sequence.deleteMany({ where: { mailboxId } }));

      if (conversationIds.length > 0) {
        await record('conversationReadState', tx.conversationReadState.deleteMany({ where: { conversationId: { in: conversationIds } } }));
        await record('conversationTagAssignment', tx.conversationTagAssignment.deleteMany({ where: { conversationId: { in: conversationIds } } }));
        await record('conversationNote', tx.conversationNote.deleteMany({ where: { conversationId: { in: conversationIds } } }));
      }
      await record('conversationMessage', tx.conversationMessage.deleteMany({ where: { mailboxId } }));
      await record('conversation', tx.conversation.deleteMany({ where: { mailboxId } }));
      await record('simulationConversationBatch', tx.simulationConversationBatch.deleteMany({ where: { mailboxId } }));

      await record('mailboxConnectionTest', tx.mailboxConnectionTest.deleteMany({ where: { mailboxId } }));
      await record('mailboxAssignment', tx.mailboxAssignment.deleteMany({ where: { mailboxId } }));

      await tx.mailbox.delete({ where: { id: mailboxId } });

      await tx.auditLog.create({
        data: {
          organizationId: resolved.organizationId,
          actorId: null,
          action: 'mailbox.hard_deleted_for_relink',
          entityType: 'Mailbox',
          entityId: mailboxId,
          metadata: { target: config.target, email: config.email, deletionCounts },
        },
      });
    },
    { timeout: 60_000 },
  );

  return { diagnosis: finalDiagnosis, deletionCounts };
}

function printApplyResult(config: CleanupMailboxConfig, result: ApplyResult): void {
  console.log(`=== cleanup-single-mailbox --apply (${config.target}) ===`);
  console.log(`Mailbox permanently deleted: ${result.diagnosis.mailboxId} (${config.email})`);
  console.log('Rows deleted, per table:');
  Object.entries(result.deletionCounts).forEach(([table, count]) => console.log(`  ${table.padEnd(30)} ${count}`));
  console.log(`\nThe email "${config.email}" can now be linked again via POST /mailboxes/link.`);
  console.log('Re-run with --check to confirm the mailbox no longer exists.');
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

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  CLEANUP_MAILBOX_LOCK_KEY,
  REQUIRED_CONFIRM_PHRASE,
  countDependents,
  diagnose,
  loadConfig,
  printApplyResult,
  printDiagnosis,
  requireConfirmation,
  requireDatabaseUrlPresent,
  requireExpectedMailboxId,
  requirePhraseConfirmation,
  resolveIds,
  runApply,
  runCheck,
};
export type { ApplyResult, CleanupMailboxConfig, Diagnosis, ResolvedIds, TableCount };
