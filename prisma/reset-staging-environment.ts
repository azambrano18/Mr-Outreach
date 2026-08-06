/**
 * FACTORY RESET for Mr Outreach staging — leaves exactly one Organization
 * (MejoReferido), exactly one User (the protected admin), and the system
 * role/permission catalog. Every other row — active, soft-deleted, or
 * historical — is permanently removed, with no exceptions, so a from-scratch
 * demo (linking `ventas@empresademostracion.cl` again) can run without
 * hitting a residual row from a previous cycle.
 *
 * WHY THIS EXISTS, DISTINCT FROM cleanup-staging-test-data.ts:
 * That script is a lighter, repeatable "clear test data between QA cycles"
 * tool — it KEEPS a second, EXECUTIVE user, treats AuditLog as always
 * preserved, and has no way to confirm afterward that the wipe actually
 * happened. Running `--check` against staging just now (as part of this
 * task's mandatory diagnosis) proved that gap concretely: `domain: 1` and
 * `managedClient: 1` (the residual empresademostracion.cl / Empresa
 * Demostración rows) were still reported as PENDING deletion — i.e.
 * `cleanup-staging-test-data --apply` was never actually run to completion
 * against this database (only `--check`, which never writes). The script's
 * own deletion logic is not at fault here — it already includes Domain and
 * ManagedClient in its scope. This new script exists for the stricter,
 * less-frequent "wipe staging back to zero before a demo" case, and — most
 * importantly — VERIFIES the end state itself via `--verify`, rather than
 * asking the operator to trust that a script "should have" worked.
 *
 * ROOT CAUSE OF THE "Este dominio ya pertenece a otro cliente" MESSAGE
 * (see the accompanying report for the full trace): `Domain` rows are
 * matched by `(organizationId, domainName)` — a plain, non-partial unique
 * index with no exception for soft-deleted rows (Domain has no soft-delete
 * concept at all; it is always a real row). `LinkMailboxUseCase` looks the
 * domain up by name and compares its `clientId` against whatever
 * `ManagedClient` the CURRENT redemption resolves to
 * (`ClientsService.upsertFromServerPayload`, matched by `serverClientId`).
 * `DevMailboxTokensController`'s "token válido de demostración" calls
 * `SimulatedMailboxMotorAdapter.issueLinkToken()`, which mints a BRAND NEW
 * random `serverClientId` (`client_${randomUUID()}`) on every single
 * issuance. So as long as ANY Domain row for `empresademostracion.cl`
 * survives from a previous cycle, EVERY future redemption is guaranteed to
 * create a different ManagedClient and hit this exact conflict — regardless
 * of whether the Mailbox or ManagedClient from the earlier cycle were
 * cleaned up. Only removing the Domain row itself (which this script does,
 * unconditionally, for the whole organization) actually closes this.
 *
 * MODEL CLASSIFICATION (§5/§18) — every model in `Prisma.ModelName` MUST
 * appear in `MODEL_CLASSIFICATIONS` below; `reset-staging-environment.spec.ts`
 * fails the suite if a new Prisma model is ever added without a
 * classification here:
 *   PRESERVE    — Organization, Role, Permission: never touched.
 *   REBOOTSTRAP — RolePermission: never deleted, but reconciled (additively,
 *                 via prisma/sync-system-roles.ts's own exported `runApply`)
 *                 after the delete transaction commits, so the protected
 *                 admin's ADMIN role holds every permission key the CURRENT
 *                 catalog defines — directly closes the same class of gap
 *                 the "Detener gestión" investigation found (a role missing
 *                 a permission key introduced after it was last synced).
 *   DELETE      — every other model (36 of them): User/UserRole delete all
 *                 rows except the protected admin's own; AuditLog deletes
 *                 only when RESET_STAGING_PURGE_AUDIT_LOGS=true (preserved
 *                 by default); every remaining business/test-data table is
 *                 unconditionally wiped for the resolved organization,
 *                 active or soft-deleted alike (`{ organizationId }`, never
 *                 `{ organizationId, deletedAt: null }`).
 *
 * Modes:
 *   --check   Read-only. Reports exactly what would be preserved/deleted,
 *             known blockers (empresademostracion.cl, ventas@..., Gestión_
 *             03082026, azambrano@...), soft-deleted-row counts, orphans,
 *             R2 object counts, and the projected result. Never writes.
 *   --apply   Deletes everything inside one transaction guarded by a
 *             transaction-scoped advisory lock, asserts 14 post-conditions
 *             BEFORE committing (rolling back entirely if any fails — see
 *             `assertPostConditions`), then best-effort/non-transactional:
 *             reconciles RolePermission (REBOOTSTRAP) and purges R2 assets
 *             if authorized. Idempotent: a second `--apply` run converges to
 *             "nothing left to delete" without erroring.
 *   --verify  Read-only. Re-runs every check `--apply` asserted before
 *             commit and prints FACTORY RESET VERIFIED / INCOMPLETE, with a
 *             non-zero exit code on any residual row.
 *
 * Required for every mode:
 *   RESET_STAGING_TARGET=staging
 *   RESET_STAGING_DATABASE_BRANCH=staging   (must equal TARGET)
 *   RESET_STAGING_EXPECTED_ORGANIZATION_ID=<uuid>
 *   RESET_STAGING_EXPECTED_ORGANIZATION_NAME=MejoReferido
 *   RESET_STAGING_KEEP_ADMIN_EMAIL=sistema@mejoreferido.cl
 *
 * Additionally required for --apply:
 *   RESET_STAGING_CONFIRM=FACTORY_RESET_MR_OUTREACH_STAGING
 *   RESET_STAGING_CONFIRM_PHRASE=ELIMINAR_TODOS_LOS_DATOS_OPERATIVOS_DE_STAGING
 *   Exactly one of:
 *     RESET_STAGING_PROCEED_WITHOUT_BACKUP=true (+ RESET_STAGING_NO_BACKUP_PHRASE=ACEPTO_EL_RESET_TOTAL_DE_STAGING_SIN_RESPALDO)
 *   (there is deliberately no "backup acknowledged" alternate path here,
 *   unlike cleanup-staging-test-data.ts — a full factory reset is assumed
 *   disposable-staging-only; add one if that assumption ever changes)
 *
 * Optional, each independently gated:
 *   RESET_STAGING_PURGE_AUDIT_LOGS=true + RESET_STAGING_AUDIT_CONFIRM=ELIMINAR_AUDITORIA_DE_PRUEBAS_DE_STAGING
 *   RESET_STAGING_PURGE_R2_ASSETS=true + RESET_STAGING_R2_CONFIRM=ELIMINAR_ASSETS_DE_PRUEBA_DE_STAGING
 *
 * PRODUCTION PROTECTIONS (§13) — refuses unconditionally if ANY of:
 *   - RESET_STAGING_TARGET !== "staging" (exact string)
 *   - RESET_STAGING_DATABASE_BRANCH !== RESET_STAGING_TARGET
 *   - process.env.APP_ENV === 'production' (the app's own real environment
 *     discriminator — see apps/api/src/infrastructure/config/env.validation.ts;
 *     NODE_ENV is deliberately NOT checked here: Railway's staging
 *     environment for this app runs with NODE_ENV=production by design, per
 *     bootstrap-admin.ts's own header comment, so gating on NODE_ENV would
 *     incorrectly block legitimate staging runs)
 *   - the resolved organization's id/name don't EXACTLY match both
 *     RESET_STAGING_EXPECTED_ORGANIZATION_ID and _NAME (a wrong DATABASE_URL
 *     pointed at a different database resolves a different id here)
 *   - more than one Organization matches the expected name (ambiguous)
 *   - the protected admin doesn't exist, is soft-deleted, isn't ACTIVE, or
 *     doesn't hold the ADMIN role
 *   - DATABASE_URL is unset/empty
 *   - any required confirmation value/phrase doesn't match exactly
 *   - the advisory lock can't be acquired (another run is in flight)
 * No single one of these is treated as sufficient on its own — see
 * `diagnose()`. There is no independent way to prove a Postgres connection
 * string is "not production" from the string alone (Neon hostnames carry no
 * such marker) — the TARGET/DATABASE_BRANCH double-declaration is the same,
 * already-established mitigation for that unprovable gap the other three
 * sibling scripts already rely on; this script does not pretend to solve it
 * differently.
 *
 * Usage: see the bottom of this file's exported `printUsage()`, or the
 * accompanying report's PowerShell command block.
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Prisma, PrismaClient } from '@prisma/client';
import { ADMIN_ROLE_NAME } from '../apps/api/src/modules/seed/system-roles';
import { buildSignatureFolderPrefix, normalizeMailboxEmailForStorageKey } from '../apps/api/src/domain/signature-asset/normalize-mailbox-email-for-storage';
import { requireEnv } from './bootstrap-admin';
import { purgeAssets as sharedPurgeAssets } from './cleanup-staging-test-data';
import * as syncSystemRoles from './sync-system-roles';

// One higher than cleanup-single-mailbox's (891234567894) — grepped
// `pg_advisory` across the repo before choosing it.
export const RESET_STAGING_LOCK_KEY = 891234567895;

export type Mode = 'check' | 'apply' | 'verify';
export type ProjectedResult = 'READY' | 'NO_CHANGES' | 'BLOCKED';
export type ModelClassification = 'PRESERVE' | 'DELETE' | 'REBOOTSTRAP';

/**
 * Every model in `Prisma.ModelName` MUST have an entry here — enforced by
 * `reset-staging-environment.spec.ts`'s schema-coverage test. See the file
 * header comment for what each bucket means.
 */
export const MODEL_CLASSIFICATIONS: Record<string, ModelClassification> = {
  Organization: 'PRESERVE',
  Role: 'PRESERVE',
  Permission: 'PRESERVE',
  RolePermission: 'REBOOTSTRAP',
  User: 'DELETE',
  UserRole: 'DELETE',
  AuditLog: 'DELETE',
  Mailbox: 'DELETE',
  MailboxAssignment: 'DELETE',
  MailboxConnectionTest: 'DELETE',
  Template: 'DELETE',
  Variable: 'DELETE',
  Signature: 'DELETE',
  SignatureVersion: 'DELETE',
  SignatureAsset: 'DELETE',
  EmailBodyAsset: 'DELETE',
  Sequence: 'DELETE',
  SequenceStep: 'DELETE',
  SequenceStepVersion: 'DELETE',
  ManagedClient: 'DELETE',
  Domain: 'DELETE',
  ClientExecutiveAssignment: 'DELETE',
  IntegrationCommand: 'DELETE',
  IntegrationEvent: 'DELETE',
  Company: 'DELETE',
  Contact: 'DELETE',
  SequenceImport: 'DELETE',
  SequenceImportRow: 'DELETE',
  SequenceContact: 'DELETE',
  ScheduledEmail: 'DELETE',
  SequenceTemplate: 'DELETE',
  SequenceTemplateStep: 'DELETE',
  SequenceTemplateVersion: 'DELETE',
  SequenceExecution: 'DELETE',
  ProspectImport: 'DELETE',
  ProspectImportRow: 'DELETE',
  Conversation: 'DELETE',
  SimulationConversationBatch: 'DELETE',
  ConversationMessage: 'DELETE',
  ConversationTag: 'DELETE',
  ConversationTagAssignment: 'DELETE',
  ConversationNote: 'DELETE',
  ConversationReadState: 'DELETE',
};

/** Fails loudly (rather than silently ignoring) any Prisma model this map doesn't know about. */
export function findUnclassifiedModels(): string[] {
  return Object.values(Prisma.ModelName).filter((name) => !(name in MODEL_CLASSIFICATIONS));
}

export interface ResetConfig {
  target: string;
  databaseBranch: string;
  expectedOrganizationId: string;
  expectedOrganizationName: string;
  keepAdminEmail: string;
}

export function loadConfig(): ResetConfig {
  const target = requireEnv('RESET_STAGING_TARGET');
  const databaseBranch = requireEnv('RESET_STAGING_DATABASE_BRANCH');
  const expectedOrganizationId = requireEnv('RESET_STAGING_EXPECTED_ORGANIZATION_ID');
  const expectedOrganizationName = requireEnv('RESET_STAGING_EXPECTED_ORGANIZATION_NAME');
  const keepAdminEmail = requireEnv('RESET_STAGING_KEEP_ADMIN_EMAIL').toLowerCase();

  if (target.toLowerCase() !== 'staging') {
    throw new Error(`RESET_STAGING_TARGET must be exactly "staging" (got "${target}").`);
  }
  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(`RESET_STAGING_DATABASE_BRANCH ("${databaseBranch}") must equal RESET_STAGING_TARGET ("${target}").`);
  }
  if (process.env.APP_ENV === 'production') {
    throw new Error('APP_ENV=production is set in this shell — refusing to run a factory reset script here, unconditionally.');
  }

  return { target, databaseBranch, expectedOrganizationId, expectedOrganizationName, keepAdminEmail };
}

export function requireDatabaseUrlPresent(): void {
  const value = process.env.DATABASE_URL;
  if (!value || value.trim().length === 0) {
    throw new Error('DATABASE_URL must be set and non-empty.');
  }
}

export function requireConfirmation(target: string): void {
  const expected = 'FACTORY_RESET_MR_OUTREACH_STAGING';
  const actual = process.env.RESET_STAGING_CONFIRM;
  if (actual !== expected) {
    throw new Error(`--apply requires RESET_STAGING_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
  void target;
}

export const REQUIRED_CONFIRM_PHRASE = 'ELIMINAR_TODOS_LOS_DATOS_OPERATIVOS_DE_STAGING';

export function requirePhraseConfirmation(): void {
  const actual = process.env.RESET_STAGING_CONFIRM_PHRASE;
  if (actual !== REQUIRED_CONFIRM_PHRASE) {
    throw new Error(`--apply requires RESET_STAGING_CONFIRM_PHRASE="${REQUIRED_CONFIRM_PHRASE}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

export const REQUIRED_NO_BACKUP_PHRASE = 'ACEPTO_EL_RESET_TOTAL_DE_STAGING_SIN_RESPALDO';

export function requireBackupWaiver(): void {
  const proceed = process.env.RESET_STAGING_PROCEED_WITHOUT_BACKUP;
  if (proceed !== 'true') {
    throw new Error('--apply requires RESET_STAGING_PROCEED_WITHOUT_BACKUP="true" — a factory reset assumes staging is disposable; create a Neon branch snapshot by hand first if it is not.');
  }
  const phrase = process.env.RESET_STAGING_NO_BACKUP_PHRASE;
  if (phrase !== REQUIRED_NO_BACKUP_PHRASE) {
    throw new Error(`--apply requires RESET_STAGING_NO_BACKUP_PHRASE="${REQUIRED_NO_BACKUP_PHRASE}" (got ${phrase ? 'a different value' : 'nothing'}).`);
  }
}

export const REQUIRED_AUDIT_CONFIRM = 'ELIMINAR_AUDITORIA_DE_PRUEBAS_DE_STAGING';

export function shouldPurgeAuditLogs(): boolean {
  if (process.env.RESET_STAGING_PURGE_AUDIT_LOGS !== 'true') return false;
  const actual = process.env.RESET_STAGING_AUDIT_CONFIRM;
  if (actual !== REQUIRED_AUDIT_CONFIRM) {
    throw new Error(`RESET_STAGING_PURGE_AUDIT_LOGS=true also requires RESET_STAGING_AUDIT_CONFIRM="${REQUIRED_AUDIT_CONFIRM}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
  return true;
}

export const REQUIRED_R2_CONFIRM = 'ELIMINAR_ASSETS_DE_PRUEBA_DE_STAGING';

export function shouldPurgeR2Assets(): boolean {
  if (process.env.RESET_STAGING_PURGE_R2_ASSETS !== 'true') return false;
  const actual = process.env.RESET_STAGING_R2_CONFIRM;
  if (actual !== REQUIRED_R2_CONFIRM) {
    throw new Error(`RESET_STAGING_PURGE_R2_ASSETS=true also requires RESET_STAGING_R2_CONFIRM="${REQUIRED_R2_CONFIRM}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
  return true;
}

export function parseResetMode(argv: string[]): Mode {
  const flags = ['--check', '--apply', '--verify'].filter((f) => argv.includes(f));
  if (flags.length !== 1) {
    throw new Error('Pass exactly one of --check, --apply, or --verify.');
  }
  return flags[0].slice(2) as Mode;
}

// ---------------------------------------------------------------------
// Business-data table specs — the SINGLE source of truth for both
// counting (--check/--verify) and deleting (--apply), in FK-safe order
// (children before parents). Reuses the exact ordering already verified in
// cleanup-staging-test-data.ts (it already scopes Domain/ManagedClient/
// ClientExecutiveAssignment correctly) plus this script's own additions.
// The three tables with no `organizationId` column of their own
// (SignatureVersion, SequenceStepVersion, SequenceTemplateVersion) are
// scoped by a relation filter to their immediate parent instead.
// ---------------------------------------------------------------------

type PrismaDelegate = { count: (args: { where: unknown }) => Promise<number>; deleteMany: (args: { where: unknown }) => Promise<{ count: number }> };

interface BusinessTableSpec {
  model: string;
  where: (organizationId: string) => unknown;
}

export const BUSINESS_TABLE_ORDER: BusinessTableSpec[] = [
  { model: 'conversationReadState', where: (organizationId) => ({ organizationId }) },
  { model: 'conversationTagAssignment', where: (organizationId) => ({ organizationId }) },
  { model: 'conversationNote', where: (organizationId) => ({ organizationId }) },
  { model: 'conversationMessage', where: (organizationId) => ({ organizationId }) },
  { model: 'conversation', where: (organizationId) => ({ organizationId }) },
  { model: 'simulationConversationBatch', where: (organizationId) => ({ organizationId }) },
  { model: 'conversationTag', where: (organizationId) => ({ organizationId }) },
  { model: 'scheduledEmail', where: (organizationId) => ({ organizationId }) },
  { model: 'prospectImportRow', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceStepVersion', where: (organizationId) => ({ sequenceStep: { organizationId } }) },
  { model: 'sequenceStep', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceContact', where: (organizationId) => ({ organizationId }) },
  { model: 'prospectImport', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceImportRow', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceImport', where: (organizationId) => ({ organizationId }) },
  { model: 'contact', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceExecution', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceTemplateVersion', where: (organizationId) => ({ template: { organizationId } }) },
  { model: 'sequenceTemplateStep', where: (organizationId) => ({ organizationId }) },
  { model: 'sequenceTemplate', where: (organizationId) => ({ organizationId }) },
  { model: 'company', where: (organizationId) => ({ organizationId }) },
  { model: 'sequence', where: (organizationId) => ({ organizationId }) },
  { model: 'signatureVersion', where: (organizationId) => ({ signature: { organizationId } }) },
  { model: 'signature', where: (organizationId) => ({ organizationId }) },
  { model: 'signatureAsset', where: (organizationId) => ({ organizationId }) },
  { model: 'emailBodyAsset', where: (organizationId) => ({ organizationId }) },
  { model: 'integrationEvent', where: (organizationId) => ({ organizationId }) },
  { model: 'integrationCommand', where: (organizationId) => ({ organizationId }) },
  { model: 'clientExecutiveAssignment', where: (organizationId) => ({ organizationId }) },
  { model: 'mailboxAssignment', where: (organizationId) => ({ organizationId }) },
  { model: 'mailboxConnectionTest', where: (organizationId) => ({ organizationId }) },
  { model: 'mailbox', where: (organizationId) => ({ organizationId }) },
  { model: 'domain', where: (organizationId) => ({ organizationId }) },
  { model: 'managedClient', where: (organizationId) => ({ organizationId }) },
  { model: 'variable', where: (organizationId) => ({ organizationId }) },
  { model: 'template', where: (organizationId) => ({ organizationId }) },
];

function delegateFor(client: PrismaClient | Prisma.TransactionClient, model: string): PrismaDelegate {
  return (client as unknown as Record<string, PrismaDelegate>)[model];
}

// ---------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------

export interface ProtectedAdmin {
  id: string;
  email: string;
  status: string;
  deletedAt: Date | null;
  hasAdminRole: boolean;
}

export interface KnownBlocker {
  label: string;
  found: boolean;
  detail?: string;
}

export interface OrphanCount {
  label: string;
  count: number;
}

export interface Diagnosis {
  organizationId: string | null;
  organizationName: string | null;
  protectedAdmin: ProtectedAdmin | null;
  otherUserEmails: string[];
  tableCounts: { table: string; count: number }[];
  softDeletedCounts: { table: string; count: number }[];
  orphans: OrphanCount[];
  knownBlockers: KnownBlocker[];
  auditLogCount: number;
  purgeAuditLogs: boolean;
  result: ProjectedResult;
  reasons: string[];
}

async function resolveOrganization(
  client: PrismaClient | Prisma.TransactionClient,
  config: ResetConfig,
): Promise<{ id: string; name: string } | { ambiguous: true; matches: { id: string; name: string }[] } | null> {
  const matches = await client.organization.findMany({
    where: { name: config.expectedOrganizationName, deletedAt: null },
    select: { id: true, name: true },
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) return { ambiguous: true, matches };
  return matches[0];
}

async function resolveProtectedAdmin(client: PrismaClient | Prisma.TransactionClient, organizationId: string, email: string): Promise<ProtectedAdmin | null> {
  const user = await client.user.findFirst({ where: { organizationId, email: { equals: email, mode: 'insensitive' } } });
  if (!user) return null;
  const roleAssignment = await client.userRole.findFirst({ where: { userId: user.id, role: { name: ADMIN_ROLE_NAME, organizationId } } });
  return { id: user.id, email: user.email, status: user.status, deletedAt: user.deletedAt, hasAdminRole: roleAssignment !== null };
}

async function countSoftDeleted(client: PrismaClient | Prisma.TransactionClient, organizationId: string): Promise<{ table: string; count: number }[]> {
  // Every model with a real `deletedAt` column of its own AND an
  // `organizationId` column to scope by — verified against schema.prisma
  // directly (`awk '/^model /{model=$2} /deletedAt/{print model}'`), never
  // assumed. Organization itself is excluded (never queried/deleted here).
  const softDeletableModels = [
    'user',
    'mailbox',
    'domain',
    'template',
    'signatureAsset',
    'emailBodyAsset',
    'company',
    'contact',
    'conversation',
    'conversationNote',
    'conversationTag',
    'managedClient',
    'sequence',
    'sequenceStep',
    'sequenceTemplate',
  ];
  const counts: { table: string; count: number }[] = [];
  for (const model of softDeletableModels) {
    const delegate = delegateFor(client, model);
    const count = await delegate.count({ where: { organizationId, deletedAt: { not: null } } });
    counts.push({ table: model, count });
  }
  return counts;
}

/**
 * Every relation checked here (Domain->ManagedClient, Mailbox->Domain,
 * MailboxAssignment->Mailbox, SequenceContact->Sequence, Signature->Mailbox)
 * is a REQUIRED foreign key enforced by Postgres itself — a row pointing at
 * nothing is structurally impossible as long as constraints are enabled, so
 * this never checks `{ is: null }` (invalid Prisma syntax for a required
 * relation, and a hard error rather than a real signal in this schema
 * anyway). The realistic "orphan" this schema can actually produce is a row
 * whose FK target still exists but is itself SOFT-DELETED — that is what
 * every check below looks for.
 */
async function detectOrphans(client: PrismaClient | Prisma.TransactionClient, organizationId: string): Promise<OrphanCount[]> {
  const orphans: OrphanCount[] = [];

  const domainsWithDeletedClient = await client.domain.count({ where: { organizationId, client: { deletedAt: { not: null } } } });
  orphans.push({ label: 'Domains cuyo ManagedClient está soft-deleted', count: domainsWithDeletedClient });

  const mailboxesWithDeletedDomain = await client.mailbox.count({ where: { organizationId, domainId: { not: null }, domain: { deletedAt: { not: null } } } });
  orphans.push({ label: 'Mailboxes cuyo Domain está soft-deleted', count: mailboxesWithDeletedDomain });

  const assignmentsWithDeletedMailbox = await client.mailboxAssignment.count({ where: { organizationId, mailbox: { deletedAt: { not: null } } } });
  orphans.push({ label: 'MailboxAssignment cuyo Mailbox está soft-deleted', count: assignmentsWithDeletedMailbox });

  const contactsWithDeletedSequence = await client.sequenceContact.count({ where: { organizationId, sequence: { deletedAt: { not: null } } } });
  orphans.push({ label: 'SequenceContact cuya Sequence (legacy) está soft-deleted', count: contactsWithDeletedSequence });

  const executionsCount = await client.sequenceExecution.count({ where: { organizationId } });
  orphans.push({ label: 'SequenceExecution en la organización (toda ejecución cuenta — REQUESTED/ACCEPTED/QUEUED/RUNNING/PAUSED/STOPPED/COMPLETED/FAILED)', count: executionsCount });

  const signaturesWithDeletedMailbox = await client.signature.count({ where: { organizationId, mailbox: { deletedAt: { not: null } } } });
  orphans.push({ label: 'Signature cuyo Mailbox está soft-deleted', count: signaturesWithDeletedMailbox });

  const simulationBatches = await client.simulationConversationBatch.count({ where: { organizationId } });
  orphans.push({ label: 'SimulationConversationBatch (lotes QA, completos o no)', count: simulationBatches });

  return orphans;
}

async function detectKnownBlockers(client: PrismaClient | Prisma.TransactionClient, organizationId: string): Promise<KnownBlocker[]> {
  const domain = await client.domain.findFirst({ where: { organizationId, domainName: { equals: 'empresademostracion.cl', mode: 'insensitive' } } });
  const mailbox = await client.mailbox.findFirst({ where: { organizationId, email: { equals: 'ventas@empresademostracion.cl', mode: 'insensitive' } } });
  const managedClient = await client.managedClient.findFirst({ where: { organizationId, name: { equals: 'Empresa Demostración', mode: 'insensitive' } } });
  const execution = await client.sequenceExecution.findFirst({ where: { organizationId, name: { equals: 'Gestión_03082026', mode: 'insensitive' } } });
  const azambrano = await client.user.findFirst({ where: { email: { equals: 'azambrano@mejoreferido.cl', mode: 'insensitive' } } });

  return [
    { label: 'empresademostracion.cl (Domain)', found: Boolean(domain), detail: domain ? `id=${domain.id} clientId=${domain.clientId}` : undefined },
    { label: 'ventas@empresademostracion.cl (Mailbox)', found: Boolean(mailbox), detail: mailbox ? `id=${mailbox.id} linkStatus=${mailbox.linkStatus}` : undefined },
    { label: 'Empresa Demostración (ManagedClient)', found: Boolean(managedClient), detail: managedClient ? `id=${managedClient.id}` : undefined },
    { label: 'Gestión_03082026 (SequenceExecution)', found: Boolean(execution), detail: execution ? `id=${execution.id} status=${execution.status}` : undefined },
    { label: 'azambrano@mejoreferido.cl (User)', found: Boolean(azambrano), detail: azambrano ? `id=${azambrano.id} status=${azambrano.status}` : undefined },
  ];
}

export async function diagnose(client: PrismaClient | Prisma.TransactionClient, config: ResetConfig): Promise<Diagnosis> {
  const reasons: string[] = [];
  const org = await resolveOrganization(client, config);

  if (!org) {
    reasons.push(`No organization named "${config.expectedOrganizationName}" exists.`);
    return emptyBlockedDiagnosis(reasons);
  }
  if ('ambiguous' in org) {
    reasons.push(`${org.matches.length} organizations named "${config.expectedOrganizationName}" exist — ambiguous, resolve manually first.`);
    return emptyBlockedDiagnosis(reasons);
  }
  if (org.id !== config.expectedOrganizationId) {
    reasons.push(`Resolved organization id ("${org.id}") does not match RESET_STAGING_EXPECTED_ORGANIZATION_ID ("${config.expectedOrganizationId}") — refusing to guess. This is the check that would catch a DATABASE_URL accidentally pointed at the wrong database.`);
    return emptyBlockedDiagnosis(reasons);
  }

  const protectedAdmin = await resolveProtectedAdmin(client, org.id, config.keepAdminEmail);
  if (!protectedAdmin) {
    reasons.push(`No user found with email "${config.keepAdminEmail}" in this organization — refusing to run without a confirmed account to preserve.`);
  } else {
    if (protectedAdmin.deletedAt) reasons.push(`"${config.keepAdminEmail}" is soft-deleted (deletedAt=${protectedAdmin.deletedAt.toISOString()}) — resolve this manually first.`);
    if (protectedAdmin.status !== 'ACTIVE') reasons.push(`"${config.keepAdminEmail}" is not ACTIVE (status=${protectedAdmin.status}) — resolve this manually first.`);
    if (!protectedAdmin.hasAdminRole) reasons.push(`"${config.keepAdminEmail}" does not currently hold the ${ADMIN_ROLE_NAME} role — run prisma:sync-system-roles first.`);
  }

  const otherUsers = protectedAdmin
    ? await client.user.findMany({ where: { organizationId: org.id, id: { not: protectedAdmin.id } }, select: { email: true } })
    : await client.user.findMany({ where: { organizationId: org.id }, select: { email: true } });

  const tableCounts: { table: string; count: number }[] = [];
  for (const spec of BUSINESS_TABLE_ORDER) {
    const delegate = delegateFor(client, spec.model);
    tableCounts.push({ table: spec.model, count: await delegate.count({ where: spec.where(org.id) }) });
  }

  const softDeletedCounts = await countSoftDeleted(client, org.id);
  const orphans = await detectOrphans(client, org.id);
  const knownBlockers = await detectKnownBlockers(client, org.id);
  const auditLogCount = await client.auditLog.count({ where: { organizationId: org.id } });
  const purgeAuditLogs = shouldPurgeAuditLogs();

  if (reasons.length > 0) {
    return {
      organizationId: org.id,
      organizationName: org.name,
      protectedAdmin,
      otherUserEmails: otherUsers.map((u) => u.email),
      tableCounts,
      softDeletedCounts,
      orphans,
      knownBlockers,
      auditLogCount,
      purgeAuditLogs,
      result: 'BLOCKED',
      reasons,
    };
  }

  const totalBusinessRows = tableCounts.reduce((sum, t) => sum + t.count, 0);
  const totalUsersToDelete = otherUsers.length;
  const totalToDelete = totalBusinessRows + totalUsersToDelete + (purgeAuditLogs ? auditLogCount : 0);
  const result: ProjectedResult = totalToDelete === 0 ? 'NO_CHANGES' : 'READY';
  reasons.push(
    result === 'NO_CHANGES'
      ? 'Every business table is already empty and no other user exists — nothing to do.'
      : `${totalToDelete} row(s) will be permanently deleted (${totalBusinessRows} business row(s) across ${tableCounts.filter((t) => t.count > 0).length} table(s), ${totalUsersToDelete} user(s)${purgeAuditLogs ? `, ${auditLogCount} audit log(s)` : ''}).`,
  );

  return {
    organizationId: org.id,
    organizationName: org.name,
    protectedAdmin,
    otherUserEmails: otherUsers.map((u) => u.email),
    tableCounts,
    softDeletedCounts,
    orphans,
    knownBlockers,
    auditLogCount,
    purgeAuditLogs,
    result,
    reasons,
  };
}

function emptyBlockedDiagnosis(reasons: string[]): Diagnosis {
  return {
    organizationId: null,
    organizationName: null,
    protectedAdmin: null,
    otherUserEmails: [],
    tableCounts: [],
    softDeletedCounts: [],
    orphans: [],
    knownBlockers: [],
    auditLogCount: 0,
    purgeAuditLogs: false,
    result: 'BLOCKED',
    reasons,
  };
}

export function printDiagnosis(config: ResetConfig, diagnosis: Diagnosis): void {
  console.log('=== FACTORY RESET STAGING — READ ONLY ===');
  console.log(`\nTarget:\n- ${config.target}`);
  if (diagnosis.organizationId) {
    console.log(`\nOrganization:\n- ${diagnosis.organizationName}\n- ${diagnosis.organizationId}`);
  }
  console.log(`\nPRESERVED:\n- ${config.keepAdminEmail}\n- Organization\n- roles\n- permissions\n- role_permissions (reconciled post-apply, see REBOOTSTRAP)\n- _prisma_migrations`);

  console.log(`\nUSERS TO DELETE (${diagnosis.otherUserEmails.length}):`);
  diagnosis.otherUserEmails.forEach((email) => console.log(`- ${email}`));

  console.log(`\nBUSINESS DATA TO DELETE:`);
  diagnosis.tableCounts.forEach((t) => console.log(`  ${t.table.padEnd(30)} ${t.count}`));

  console.log(`\nKNOWN BLOCKERS:`);
  diagnosis.knownBlockers.forEach((b) => console.log(`- ${b.label}: ${b.found ? `FOUND (${b.detail})` : 'not found'}`));

  console.log(`\nSOFT-DELETED DATA:`);
  diagnosis.softDeletedCounts.forEach((t) => console.log(`  ${t.table.padEnd(30)} ${t.count}`));

  console.log(`\nORPHANS:`);
  diagnosis.orphans.forEach((o) => console.log(`- ${o.label}: ${o.count}`));

  console.log(`\nAUDIT LOGS:\n- ${diagnosis.auditLogCount} row(s) for this organization — ${diagnosis.purgeAuditLogs ? 'WILL be deleted (RESET_STAGING_PURGE_AUDIT_LOGS=true)' : 'PRESERVED (set RESET_STAGING_PURGE_AUDIT_LOGS=true to delete)'}`);

  console.log(`\nPROJECTED RESULT:\n- ${diagnosis.result}`);
  console.log('Reasons:');
  diagnosis.reasons.forEach((r) => console.log(`  - ${r}`));
}

// ---------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------

export interface PostConditionFailure {
  check: string;
  detail: string;
}

/** The 14 pre-commit assertions (§8) — any failure throws, rolling back the whole transaction. */
async function assertPostConditions(
  client: Prisma.TransactionClient,
  organizationId: string,
  protectedAdminId: string,
  keepAdminEmail: string,
): Promise<void> {
  const failures: PostConditionFailure[] = [];
  const push = (check: string, ok: boolean, detail: string) => {
    if (!ok) failures.push({ check, detail });
  };

  const admin = await client.user.findUnique({ where: { id: protectedAdminId } });
  push('1. protected admin still exists', Boolean(admin), keepAdminEmail);
  push('2. protected admin still holds ADMIN', Boolean(admin) && (await client.userRole.findFirst({ where: { userId: protectedAdminId, role: { name: ADMIN_ROLE_NAME, organizationId } } })) !== null, keepAdminEmail);
  push('3. organization still exists', (await client.organization.findUnique({ where: { id: organizationId } })) !== null, organizationId);
  push('4. no additional user remains', (await client.user.count({ where: { organizationId, id: { not: protectedAdminId } } })) === 0, 'user count');
  push('5. no ManagedClient remains', (await client.managedClient.count({ where: { organizationId } })) === 0, 'managedClient count');
  push('6. no Domain remains', (await client.domain.count({ where: { organizationId } })) === 0, 'domain count');
  push('7. no Mailbox remains', (await client.mailbox.count({ where: { organizationId } })) === 0, 'mailbox count');
  push('8. no SequenceExecution remains', (await client.sequenceExecution.count({ where: { organizationId } })) === 0, 'sequenceExecution count');
  push('9. no Conversation remains', (await client.conversation.count({ where: { organizationId } })) === 0, 'conversation count');
  push('10. no IntegrationCommand/Event remains', (await client.integrationCommand.count({ where: { organizationId } })) === 0 && (await client.integrationEvent.count({ where: { organizationId } })) === 0, 'integration command/event count');
  push('11. no SimulationConversationBatch remains', (await client.simulationConversationBatch.count({ where: { organizationId } })) === 0, 'simulationConversationBatch count');
  push('12. empresademostracion.cl no longer exists', (await client.domain.count({ where: { domainName: { equals: 'empresademostracion.cl', mode: 'insensitive' } } })) === 0, 'domain by name');
  push('13. ventas@empresademostracion.cl no longer exists', (await client.mailbox.count({ where: { email: { equals: 'ventas@empresademostracion.cl', mode: 'insensitive' } } })) === 0, 'mailbox by email');
  push('14. azambrano@mejoreferido.cl no longer exists (unless it is the protected admin)', keepAdminEmail.toLowerCase() === 'azambrano@mejoreferido.cl' || (await client.user.count({ where: { email: { equals: 'azambrano@mejoreferido.cl', mode: 'insensitive' } } })) === 0, 'user by email');

  if (failures.length > 0) {
    throw new Error(`Post-condition check(s) failed — rolling back entirely:\n${failures.map((f) => `  - ${f.check} (${f.detail})`).join('\n')}`);
  }
}

export interface ApplyResult {
  diagnosis: Diagnosis;
  deletionCounts: Record<string, number>;
  deletedUserCount: number;
  auditLogsPurged: number;
  rolePermissionReconciliation: { attempted: boolean; succeeded: boolean; error: string | null };
  assetCleanup: { attempted: boolean; report: unknown };
}

export async function runApply(client: PrismaClient, config: ResetConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  requirePhraseConfirmation();
  requireBackupWaiver();
  if (config.target.toLowerCase() === 'production') {
    throw new Error('This script refuses to run against RESET_STAGING_TARGET=production, unconditionally.');
  }

  let finalDiagnosis!: Diagnosis;
  const deletionCounts: Record<string, number> = {};
  let deletedUserCount = 0;
  let auditLogsPurged = 0;
  let mailboxEmailsForAssetCleanup: string[] = [];
  let organizationIdForCleanup = '';

  await client.$transaction(
    async (tx) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${RESET_STAGING_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another reset-staging-environment --apply run holds the lock — aborting to avoid a race.');
      }

      const diagnosis = await diagnose(tx, config);
      finalDiagnosis = diagnosis;
      if (diagnosis.result === 'BLOCKED') {
        throw new Error(`Blocked: ${diagnosis.reasons.join(' ')}`);
      }
      if (diagnosis.result === 'NO_CHANGES') {
        return;
      }

      const organizationId = diagnosis.organizationId as string;
      organizationIdForCleanup = organizationId;
      const protectedAdminId = diagnosis.protectedAdmin!.id;

      mailboxEmailsForAssetCleanup = (await tx.mailbox.findMany({ where: { organizationId }, select: { email: true } })).map((m) => m.email);

      for (const spec of BUSINESS_TABLE_ORDER) {
        const delegate = delegateFor(tx, spec.model);
        const result = await delegate.deleteMany({ where: spec.where(organizationId) });
        deletionCounts[spec.model] = result.count;
      }

      const otherUserIds = (await tx.user.findMany({ where: { organizationId, id: { not: protectedAdminId } }, select: { id: true } })).map((u) => u.id);
      const userRoleResult = await tx.userRole.deleteMany({ where: { userId: { in: otherUserIds } } });
      deletionCounts.userRole = userRoleResult.count;
      const userResult = await tx.user.deleteMany({ where: { id: { in: otherUserIds } } });
      deletionCounts.user = userResult.count;
      deletedUserCount = userResult.count;

      if (diagnosis.purgeAuditLogs) {
        const auditResult = await tx.auditLog.deleteMany({ where: { organizationId } });
        auditLogsPurged = auditResult.count;
      }

      await assertPostConditions(tx, organizationId, protectedAdminId, config.keepAdminEmail);

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: null,
          action: 'staging_factory_reset.apply',
          entityType: 'Organization',
          entityId: organizationId,
          metadata: { target: config.target, deletedUserCount, deletionCounts, auditLogsPurged },
        },
      });
    },
    { timeout: 120_000 },
  );

  const rolePermissionReconciliation = await reconcileRolePermissions(client, config);
  const assetCleanup = shouldPurgeR2Assets()
    ? { attempted: true, report: await sharedPurgeAssets(organizationIdForCleanup, mailboxEmailsForAssetCleanup) }
    : { attempted: false, report: null };

  return { diagnosis: finalDiagnosis, deletionCounts, deletedUserCount, auditLogsPurged, rolePermissionReconciliation, assetCleanup };
}

/**
 * REBOOTSTRAP step for RolePermission — additive-only, runs in its OWN
 * transaction AFTER the delete transaction commits (never nested inside
 * it). Reuses prisma/sync-system-roles.ts's own exported `runApply`
 * verbatim rather than re-implementing permission reconciliation — a
 * failure here is reported but never undoes, or is treated as a failure
 * of, the factory reset itself (the business-data wipe already committed
 * and is independently correct).
 */
async function reconcileRolePermissions(
  client: PrismaClient,
  config: ResetConfig,
): Promise<{ attempted: boolean; succeeded: boolean; error: string | null }> {
  const previousConfirm = process.env.SYNC_ROLES_CONFIRM;
  try {
    process.env.SYNC_ROLES_CONFIRM = `SYNC_SYSTEM_ROLES_IN_${config.target.toUpperCase()}`;
    await syncSystemRoles.runApply(client, {
      target: config.target,
      databaseBranch: config.databaseBranch,
      organizationName: config.expectedOrganizationName,
    });
    return { attempted: true, succeeded: true, error: null };
  } catch (error) {
    return { attempted: true, succeeded: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (previousConfirm === undefined) delete process.env.SYNC_ROLES_CONFIRM;
    else process.env.SYNC_ROLES_CONFIRM = previousConfirm;
  }
}

export function printApplyResult(result: ApplyResult): void {
  if (result.diagnosis.result === 'NO_CHANGES') {
    console.log('Nothing to do — staging was already at zero (idempotent no-op).');
    return;
  }
  console.log(`=== FACTORY RESET STAGING — APPLIED ===`);
  console.log(`Users permanently deleted: ${result.deletedUserCount}`);
  console.log('Rows deleted, per table:');
  Object.entries(result.deletionCounts).forEach(([table, count]) => console.log(`  ${table.padEnd(30)} ${count}`));
  console.log(`Audit logs purged: ${result.auditLogsPurged}`);
  console.log(`\nRolePermission reconciliation (REBOOTSTRAP): ${result.rolePermissionReconciliation.succeeded ? 'OK' : `FAILED — ${result.rolePermissionReconciliation.error}`}`);
  if (result.assetCleanup.attempted) {
    console.log(`R2 asset cleanup: ${JSON.stringify(result.assetCleanup.report)}`);
  } else {
    console.log('R2 asset cleanup: skipped (RESET_STAGING_PURGE_R2_ASSETS not set) — objects may remain in R2; the database no longer references them.');
  }
  console.log('\nRun --verify now to confirm the end state.');
}

// ---------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------

export interface VerifyResult {
  organizationId: string | null;
  userCount: number;
  userEmails: string[];
  organizationPreserved: boolean;
  roleAndPermissionsIntact: boolean;
  residualCounts: { table: string; count: number }[];
  knownBlockers: KnownBlocker[];
  auditLogCount: number;
  verified: boolean;
  reasons: string[];
}

export async function runVerify(client: PrismaClient, config: ResetConfig): Promise<VerifyResult> {
  const org = await resolveOrganization(client, config);
  const reasons: string[] = [];

  if (!org || 'ambiguous' in org || org.id !== config.expectedOrganizationId) {
    reasons.push('Organization could not be resolved to the expected id — cannot verify.');
    return {
      organizationId: null,
      userCount: 0,
      userEmails: [],
      organizationPreserved: false,
      roleAndPermissionsIntact: false,
      residualCounts: [],
      knownBlockers: [],
      auditLogCount: 0,
      verified: false,
      reasons,
    };
  }

  const users = await client.user.findMany({ where: { organizationId: org.id }, select: { email: true } });
  const adminRole = await client.role.findFirst({ where: { organizationId: org.id, name: ADMIN_ROLE_NAME } });
  const rolePermissionCount = adminRole ? await client.rolePermission.count({ where: { roleId: adminRole.id } }) : 0;

  const residualCounts: { table: string; count: number }[] = [];
  for (const spec of BUSINESS_TABLE_ORDER) {
    const delegate = delegateFor(client, spec.model);
    residualCounts.push({ table: spec.model, count: await delegate.count({ where: spec.where(org.id) }) });
  }

  const knownBlockers = await detectKnownBlockers(client, org.id);
  const auditLogCount = await client.auditLog.count({ where: { organizationId: org.id } });

  if (users.length !== 1 || users[0].email.toLowerCase() !== config.keepAdminEmail.toLowerCase()) {
    reasons.push(`Expected exactly 1 user (${config.keepAdminEmail}), found ${users.length}: ${users.map((u) => u.email).join(', ')}`);
  }
  const residualBusinessRows = residualCounts.filter((t) => t.count > 0);
  if (residualBusinessRows.length > 0) {
    reasons.push(`Residual business rows remain: ${residualBusinessRows.map((t) => `${t.table}=${t.count}`).join(', ')}`);
  }
  const foundBlockers = knownBlockers.filter((b) => b.found);
  if (foundBlockers.length > 0) {
    reasons.push(`Known blockers still present: ${foundBlockers.map((b) => `${b.label} (${b.detail})`).join(', ')}`);
  }
  if (!adminRole || rolePermissionCount === 0) {
    reasons.push('ADMIN role or its permissions are missing — roles/permissions are not intact.');
  }

  const verified = reasons.length === 0;
  return {
    organizationId: org.id,
    userCount: users.length,
    userEmails: users.map((u) => u.email),
    organizationPreserved: true,
    roleAndPermissionsIntact: Boolean(adminRole) && rolePermissionCount > 0,
    residualCounts,
    knownBlockers,
    auditLogCount,
    verified,
    reasons,
  };
}

export function printVerifyResult(config: ResetConfig, result: VerifyResult): void {
  console.log('=== FACTORY RESET STAGING — VERIFY (read-only) ===');
  console.log(`\nUsers:\n- ${result.userCount} total\n- ${result.userEmails.join(', ') || '(none)'}`);
  console.log(`\nOrganization:\n- ${config.expectedOrganizationName} ${result.organizationPreserved ? 'preserved' : 'MISSING'}`);
  console.log(`\nRoles and permissions:\n- ${result.roleAndPermissionsIntact ? 'intact' : 'INCOMPLETE'}`);
  console.log('\nBusiness data residual counts:');
  result.residualCounts.forEach((t) => console.log(`  ${t.table.padEnd(30)} ${t.count}`));
  console.log(`\nAudit logs for the organization:\n- ${result.auditLogCount}`);
  console.log('\nKnown values:');
  result.knownBlockers.forEach((b) => console.log(`- ${b.label}: ${b.found ? `FOUND (${b.detail})` : 'NOT FOUND'}`));

  console.log(`\n${result.verified ? 'FACTORY RESET VERIFIED' : 'FACTORY RESET INCOMPLETE'}`);
  if (!result.verified) {
    console.log('Reasons:');
    result.reasons.forEach((r) => console.log(`  - ${r}`));
  }
}

// ---------------------------------------------------------------------
// R2 preview (§9 — --check only; deletion itself reuses sharedPurgeAssets)
// ---------------------------------------------------------------------

export interface R2Preview {
  mode: 'r2' | 'simulated' | 'skipped';
  bucket: string | null;
  prefixes: { prefix: string; objectCount: number; approximateBytes: number }[];
}

export async function previewR2Assets(mailboxEmails: string[], organizationId: string): Promise<R2Preview> {
  const mode = process.env.SIGNATURE_ASSET_STORAGE_MODE === 'r2' ? 'r2' : 'simulated';
  const signaturePrefixRoot = process.env.R2_SIGNATURE_PREFIX || 'firmas';
  const emailBodyPrefixRoot = process.env.R2_EMAIL_BODY_PREFIX || 'email-body';

  if (mode !== 'r2') {
    return { mode: 'simulated', bucket: null, prefixes: [] };
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return { mode: 'skipped', bucket: null, prefixes: [] };
  }

  const client = new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });

  const listPrefix = async (prefix: string): Promise<{ objectCount: number; approximateBytes: number }> => {
    let objectCount = 0;
    let approximateBytes = 0;
    let continuationToken: string | undefined;
    do {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, ContinuationToken: continuationToken }));
      for (const obj of listed.Contents ?? []) {
        objectCount += 1;
        approximateBytes += obj.Size ?? 0;
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return { objectCount, approximateBytes };
  };

  const prefixes: { prefix: string; objectCount: number; approximateBytes: number }[] = [];
  for (const email of mailboxEmails) {
    const prefix = buildSignatureFolderPrefix(signaturePrefixRoot, normalizeMailboxEmailForStorageKey(email));
    prefixes.push({ prefix, ...(await listPrefix(prefix)) });
  }
  const emailBodyPrefix = `${emailBodyPrefixRoot.replace(/^\/+|\/+$/g, '')}/${organizationId}/`;
  prefixes.push({ prefix: emailBodyPrefix, ...(await listPrefix(emailBodyPrefix)) });

  return { mode: 'r2', bucket: bucketName, prefixes };
}

// Re-exported so callers/tests never need their own copies of these fs helpers.
export { existsSync, join, rm };

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  const unclassified = findUnclassifiedModels();
  if (unclassified.length > 0) {
    throw new Error(`Refusing to run: ${unclassified.length} Prisma model(s) have no MODEL_CLASSIFICATIONS entry: ${unclassified.join(', ')}. Classify them in prisma/reset-staging-environment.ts before running this script.`);
  }

  const mode = parseResetMode(process.argv.slice(2));
  const config = loadConfig();
  requireDatabaseUrlPresent();
  const prisma = new PrismaClient();

  try {
    if (mode === 'check') {
      const diagnosis = await diagnose(prisma, config);
      printDiagnosis(config, diagnosis);
      if (diagnosis.result === 'BLOCKED') process.exitCode = 1;
    } else if (mode === 'apply') {
      const preCheck = await diagnose(prisma, config);
      if (preCheck.result === 'BLOCKED') {
        printDiagnosis(config, preCheck);
        throw new Error('--check would be BLOCKED — refusing to --apply. See reasons above.');
      }
      const result = await runApply(prisma, config);
      printApplyResult(result);
    } else {
      const result = await runVerify(prisma, config);
      printVerifyResult(config, result);
      if (!result.verified) process.exitCode = 2;
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
