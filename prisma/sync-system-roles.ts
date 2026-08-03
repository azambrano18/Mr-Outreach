/**
 * Idempotent sync of the two system roles (ADMIN, EXECUTIVE) and the shared
 * permission catalog for one already-existing organization. Built because
 * staging had only ADMIN — "Crear ejecutivo" had no EXECUTIVE role to
 * assign, and the fix is an operational gap, not a code bug: this script
 * closes it safely, without reaching for prisma/seed.ts (dev-only, not
 * idempotent, refuses to run under NODE_ENV=production) or hand-written SQL.
 *
 * Distinct from prisma/bootstrap-admin.ts: that script creates the
 * organization AND its first ADMIN user; this one never creates an
 * organization or a user — it only ensures the two system roles exist and
 * hold their full permission set, for an organization the operator names
 * explicitly. Both scripts share the same permission-catalog source
 * (apps/api/src/modules/seed/permission-catalog.ts) and the same
 * check/apply/advisory-lock conventions.
 *
 * What this script does NOT do (by design):
 *   - create an organization (BLOCKED if the named one doesn't exist)
 *   - create any user (demo or otherwise)
 *   - modify any organization other than the one explicitly named
 *   - delete or touch any custom role — only ADMIN/EXECUTIVE are read/written
 *   - remove a permission a role already has that isn't in its catalog set
 *     (additive-only, like bootstrap-admin's ADMIN reconciliation)
 *   - print any credential (there are none to print — this script never
 *     touches passwords)
 *
 * Modes:
 *   --check   Read-only diagnostic/dry-run. Reports CREATE / RECONCILE /
 *             NO_CHANGES / BLOCKED. Never writes. Always safe to run.
 *   --apply   Writes inside a single transaction guarded by a
 *             transaction-scoped advisory lock (distinct key from
 *             bootstrap-admin's, so the two can never contend). Requires
 *             SYNC_ROLES_CONFIRM. Refuses SYNC_ROLES_TARGET=production
 *             unconditionally — a separate, explicit procedure is required
 *             for production, same posture as bootstrap-admin.
 *
 * Usage:
 *   SYNC_ROLES_TARGET=staging \
 *   SYNC_ROLES_DATABASE_BRANCH=staging \
 *   SYNC_ROLES_CONFIRM=SYNC_SYSTEM_ROLES_IN_STAGING \
 *   SYNC_ROLES_ORGANIZATION_NAME=MejoReferido \
 *   npm run prisma:sync-system-roles -- --apply
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { ADMIN_PERMISSION_KEYS, EXECUTIVE_PERMISSION_KEYS, PERMISSION_CATALOG } from '../apps/api/src/modules/seed/permission-catalog';
import { ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME } from '../apps/api/src/modules/seed/system-roles';
import { parseMode, requireEnv } from './bootstrap-admin';

// One higher than BOOTSTRAP_LOCK_KEY (891234567891) — grepped `pg_advisory`
// across the repo before choosing it; the two scripts never take the same
// lock, so a bootstrap-admin --apply and a sync-system-roles --apply can
// never deadlock each other, only naturally serialize via Postgres MVCC.
const SYNC_ROLES_LOCK_KEY = 891234567892;

type Mode = 'check' | 'apply';
type ProjectedResult = 'CREATE' | 'RECONCILE' | 'NO_CHANGES' | 'BLOCKED';

interface SyncConfig {
  target: string;
  databaseBranch: string;
  organizationName: string;
}

interface RoleDiagnosis {
  roleName: string;
  roleId: string | null;
  existingPermissionKeys: string[];
  missingPermissionKeys: string[];
}

interface Diagnosis {
  organizations: { id: string; name: string }[];
  targetOrganizationId: string | null;
  missingCatalogPermissionKeys: string[];
  adminRole: RoleDiagnosis;
  executiveRole: RoleDiagnosis;
  result: ProjectedResult;
  reasons: string[];
}

function loadConfig(): SyncConfig {
  const target = requireEnv('SYNC_ROLES_TARGET');
  const databaseBranch = requireEnv('SYNC_ROLES_DATABASE_BRANCH');
  const organizationName = requireEnv('SYNC_ROLES_ORGANIZATION_NAME');

  // Same redundant, human-asserted double-confirmation as bootstrap-admin's
  // BOOTSTRAP_DATABASE_BRANCH — does not technically verify which Neon
  // branch DATABASE_URL points at, only catches a copy-paste mismatch
  // between the two variables.
  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `SYNC_ROLES_DATABASE_BRANCH ("${databaseBranch}") must equal SYNC_ROLES_TARGET ("${target}") — refusing to continue on a mismatch.`,
    );
  }

  return { target, databaseBranch, organizationName };
}

function requireConfirmation(target: string): void {
  const expected = `SYNC_SYSTEM_ROLES_IN_${target.toUpperCase()}`;
  const actual = process.env.SYNC_ROLES_CONFIRM;
  if (actual !== expected) {
    throw new Error(`--apply requires SYNC_ROLES_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`);
  }
}

async function diagnoseRole(
  client: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  roleName: string,
  requiredPermissionKeys: readonly string[],
): Promise<RoleDiagnosis> {
  const role = await client.role.findFirst({ where: { organizationId, name: roleName }, select: { id: true } });
  if (!role) {
    return { roleName, roleId: null, existingPermissionKeys: [], missingPermissionKeys: [...requiredPermissionKeys] };
  }

  const rolePermissions = await client.rolePermission.findMany({
    where: { roleId: role.id },
    select: { permissionKey: true },
  });
  const existingPermissionKeys = rolePermissions.map((rp) => rp.permissionKey);
  const missingPermissionKeys = requiredPermissionKeys.filter((key) => !existingPermissionKeys.includes(key));

  return { roleName, roleId: role.id, existingPermissionKeys, missingPermissionKeys };
}

async function diagnose(client: PrismaClient | Prisma.TransactionClient, config: SyncConfig): Promise<Diagnosis> {
  const organizations = await client.organization.findMany({
    where: { name: config.organizationName, deletedAt: null },
    select: { id: true, name: true },
  });

  if (organizations.length !== 1) {
    const reasons =
      organizations.length === 0
        ? [
            `No organization named "${config.organizationName}" exists. This script never creates organizations — create it first (e.g. via bootstrap-admin) before syncing roles.`,
          ]
        : [
            `${organizations.length} organizations named "${config.organizationName}" exist (ids: ${organizations
              .map((o) => o.id)
              .join(', ')}) — ambiguous target, resolve manually before retrying.`,
          ];
    return {
      organizations,
      targetOrganizationId: null,
      missingCatalogPermissionKeys: PERMISSION_CATALOG.map((p) => p.key),
      adminRole: { roleName: ADMIN_ROLE_NAME, roleId: null, existingPermissionKeys: [], missingPermissionKeys: [...ADMIN_PERMISSION_KEYS] },
      executiveRole: {
        roleName: EXECUTIVE_ROLE_NAME,
        roleId: null,
        existingPermissionKeys: [],
        missingPermissionKeys: [...EXECUTIVE_PERMISSION_KEYS],
      },
      result: 'BLOCKED',
      reasons,
    };
  }

  const targetOrganizationId = organizations[0].id;

  const existingCatalogPermissions = await client.permission.findMany({ select: { key: true } });
  const existingCatalogKeys = new Set(existingCatalogPermissions.map((p) => p.key));
  const missingCatalogPermissionKeys = PERMISSION_CATALOG.filter((p) => !existingCatalogKeys.has(p.key)).map((p) => p.key);

  const adminRole = await diagnoseRole(client, targetOrganizationId, ADMIN_ROLE_NAME, ADMIN_PERMISSION_KEYS);
  const executiveRole = await diagnoseRole(client, targetOrganizationId, EXECUTIVE_ROLE_NAME, EXECUTIVE_PERMISSION_KEYS);

  const reasons: string[] = [];
  let result: ProjectedResult;
  if (!adminRole.roleId || !executiveRole.roleId) {
    result = 'CREATE';
    if (!adminRole.roleId) reasons.push(`The ${ADMIN_ROLE_NAME} role does not exist yet in this organization.`);
    if (!executiveRole.roleId) reasons.push(`The ${EXECUTIVE_ROLE_NAME} role does not exist yet in this organization.`);
  } else if (
    missingCatalogPermissionKeys.length > 0 ||
    adminRole.missingPermissionKeys.length > 0 ||
    executiveRole.missingPermissionKeys.length > 0
  ) {
    result = 'RECONCILE';
    if (missingCatalogPermissionKeys.length > 0) {
      reasons.push(`${missingCatalogPermissionKeys.length} permission(s) missing from the shared catalog.`);
    }
    if (adminRole.missingPermissionKeys.length > 0) {
      reasons.push(`${adminRole.missingPermissionKeys.length} permission(s) missing from ${ADMIN_ROLE_NAME}.`);
    }
    if (executiveRole.missingPermissionKeys.length > 0) {
      reasons.push(`${executiveRole.missingPermissionKeys.length} permission(s) missing from ${EXECUTIVE_ROLE_NAME}.`);
    }
  } else {
    result = 'NO_CHANGES';
    reasons.push('Both system roles exist and already hold every permission required by the catalog.');
  }

  return { organizations, targetOrganizationId, missingCatalogPermissionKeys, adminRole, executiveRole, result, reasons };
}

function printDiagnosis(config: SyncConfig, diagnosis: Diagnosis): void {
  console.log('=== sync-system-roles --check (read-only) ===');
  console.log(`Target: ${config.target}`);
  console.log(`Declared database branch (human-asserted, not independently verified): ${config.databaseBranch}`);
  console.log(`Organization requested: "${config.organizationName}"`);
  console.log(
    diagnosis.organizations.length === 1
      ? `  -> found: ${diagnosis.organizations[0].id}`
      : `  -> ${diagnosis.organizations.length} match(es) (expected exactly 1)`,
  );
  console.log(`Missing catalog permissions: ${diagnosis.missingCatalogPermissionKeys.length}/${PERMISSION_CATALOG.length}`);
  if (diagnosis.missingCatalogPermissionKeys.length > 0) {
    console.log(`  -> ${diagnosis.missingCatalogPermissionKeys.join(', ')}`);
  }
  for (const role of [diagnosis.adminRole, diagnosis.executiveRole]) {
    console.log(
      `${role.roleName} role: ${role.roleId ?? '(does not exist yet)'} — ${role.existingPermissionKeys.length} permission(s) present, ${role.missingPermissionKeys.length} missing`,
    );
    // Named explicitly (not just a count) — this is exactly what lets an
    // operator answer "is permission X specifically assigned to this
    // role?" from --check output alone, without guessing from a number.
    if (role.missingPermissionKeys.length > 0) {
      console.log(`  -> missing: ${role.missingPermissionKeys.join(', ')}`);
    }
  }
  console.log(`\nProjected result: ${diagnosis.result}`);
  console.log('Reasons:');
  diagnosis.reasons.forEach((reason) => console.log(`  - ${reason}`));
}

async function runCheck(client: PrismaClient, config: SyncConfig): Promise<Diagnosis> {
  const diagnosis = await diagnose(client, config);
  printDiagnosis(config, diagnosis);
  if (diagnosis.result === 'BLOCKED') {
    process.exitCode = 1;
  }
  return diagnosis;
}

interface ApplyResult {
  diagnosis: Diagnosis;
}

async function runApply(client: PrismaClient, config: SyncConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  if (config.target.toLowerCase() === 'production') {
    throw new Error(
      'This script refuses to run against SYNC_ROLES_TARGET=production. Syncing system roles in production requires a separate, explicit procedure.',
    );
  }

  let finalDiagnosis!: Diagnosis;

  await client.$transaction(
    async (tx) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SYNC_ROLES_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another sync-system-roles --apply run holds the lock — aborting to avoid a race.');
      }

      const diagnosis = await diagnose(tx, config);
      finalDiagnosis = diagnosis;
      if (diagnosis.result === 'BLOCKED') {
        throw new Error(`Blocked: ${diagnosis.reasons.join(' ')}`);
      }

      if (diagnosis.missingCatalogPermissionKeys.length > 0) {
        const missing = new Set(diagnosis.missingCatalogPermissionKeys);
        const toCreate = PERMISSION_CATALOG.filter((p) => missing.has(p.key));
        await tx.permission.createMany({ data: toCreate, skipDuplicates: true });
      }

      const organizationId = diagnosis.targetOrganizationId as string;

      const adminRoleId =
        diagnosis.adminRole.roleId ?? (await tx.role.create({ data: { organizationId, name: ADMIN_ROLE_NAME } })).id;
      if (diagnosis.adminRole.missingPermissionKeys.length > 0) {
        await tx.rolePermission.createMany({
          data: diagnosis.adminRole.missingPermissionKeys.map((permissionKey) => ({ roleId: adminRoleId, permissionKey })),
          skipDuplicates: true,
        });
      }

      const executiveRoleId =
        diagnosis.executiveRole.roleId ??
        (await tx.role.create({ data: { organizationId, name: EXECUTIVE_ROLE_NAME } })).id;
      if (diagnosis.executiveRole.missingPermissionKeys.length > 0) {
        await tx.rolePermission.createMany({
          data: diagnosis.executiveRole.missingPermissionKeys.map((permissionKey) => ({
            roleId: executiveRoleId,
            permissionKey,
          })),
          skipDuplicates: true,
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: null,
          action: 'system_roles.sync',
          entityType: 'Organization',
          entityId: organizationId,
          metadata: {
            target: config.target,
            projectedResult: diagnosis.result,
            catalogPermissionsAdded: diagnosis.missingCatalogPermissionKeys.length,
            adminRoleCreated: diagnosis.adminRole.roleId === null,
            adminPermissionsAdded: diagnosis.adminRole.missingPermissionKeys.length,
            executiveRoleCreated: diagnosis.executiveRole.roleId === null,
            executivePermissionsAdded: diagnosis.executiveRole.missingPermissionKeys.length,
          },
        },
      });
    },
    { timeout: 15_000 },
  );

  return { diagnosis: finalDiagnosis };
}

function printApplyResult(config: SyncConfig, result: ApplyResult): void {
  console.log(`System roles synced for organization "${config.organizationName}" (${config.target}).`);
  console.log(`${ADMIN_ROLE_NAME}: ${result.diagnosis.adminRole.roleId ? 'reconciled' : 'created'}`);
  console.log(`${EXECUTIVE_ROLE_NAME}: ${result.diagnosis.executiveRole.roleId ? 'reconciled' : 'created'}`);
  console.log('No credentials are created or changed by this script.');
}

async function main(): Promise<void> {
  const mode: Mode = parseMode(process.argv.slice(2));
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

// Guarded so importing this module for tests never opens a PrismaClient.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { SYNC_ROLES_LOCK_KEY, diagnose, loadConfig, printApplyResult, printDiagnosis, requireConfirmation, runApply, runCheck };
export type { ApplyResult, Diagnosis, ProjectedResult, RoleDiagnosis, SyncConfig };
