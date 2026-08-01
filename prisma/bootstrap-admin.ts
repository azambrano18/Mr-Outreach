/**
 * One-off administrative bootstrap for the first real ADMIN user in a given
 * environment (staging today — production requires separate, explicit
 * authorization; see docs/production-blockers.md).
 *
 * Distinct from prisma/seed.ts, which is development-only, always creates
 * new rows (never idempotent), and requires DEV_ADMIN_* / DEV_EXECUTIVE_*
 * variables that must never exist alongside NODE_ENV=production (see
 * apps/api/scripts/production-preflight-check.js). This script never reads
 * DEV_ADMIN_* / DEV_EXECUTIVE_* and is safe to run with NODE_ENV=production
 * set (that is in fact how Railway's "staging" environment is configured
 * today for mr-outreach-api).
 *
 * Modes:
 *   --check   Read-only. Reports current state and the projected outcome
 *             (CREATE / RECONCILE / NO_CHANGES / BLOCKED). Never writes.
 *   --apply   Performs the bootstrap inside a single Postgres transaction,
 *             guarded by a transaction-scoped advisory lock so two
 *             concurrent runs can't race. Idempotent: a second --apply run
 *             converges to NO_CHANGES — it never creates a duplicate
 *             organization/role/user, never duplicates permissions, and
 *             never regenerates or changes a password for a user that
 *             already existed.
 *
 * Usage (see docs for the full Railway console procedure):
 *   BOOTSTRAP_TARGET=staging \
 *   BOOTSTRAP_DATABASE_BRANCH=staging \
 *   BOOTSTRAP_CONFIRM=CREATE_INITIAL_ADMIN_IN_STAGING \
 *   BOOTSTRAP_ORGANIZATION_NAME=MejoReferido \
 *   BOOTSTRAP_ADMIN_EMAIL=nombre.apellido@mejoreferido.cl \
 *   BOOTSTRAP_ADMIN_FIRST_NAME=Nombre \
 *   BOOTSTRAP_ADMIN_LAST_NAME=Apellido \
 *   npm run prisma:bootstrap-admin -- --check
 *
 * Never runs `prisma migrate reset`/`prisma db push`, never deletes
 * anything, never prints a password hash, and never prints an existing
 * user's password (only a newly generated one, once, after commit).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
// Imported directly from the real source rather than duplicated (unlike
// prisma/seed.ts's deliberate duplicate) because this exact duplication
// already drifted once: seed.ts's inline copy is missing the
// `dev_tools.simulate_motor_events` key added later to the real catalog.
// Both files are decorator-free plain data/logic with only relative
// imports, so ts-node compiles them with no dependency on apps/api's
// NestJS-specific tsconfig.
import { ADMIN_PERMISSION_KEYS, PERMISSION_CATALOG } from '../apps/api/src/modules/seed/permission-catalog';
import { generateTemporaryPassword } from '../apps/api/src/application/users/temporary-password.generator';

const PASSWORD_HASH_ROUNDS = 10;
const ADMIN_ROLE_NAME = 'ADMIN';
const REQUIRED_EMAIL_DOMAIN = '@mejoreferido.cl';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Arbitrary fixed key for this script's advisory lock only — grepped
// `pg_advisory` across the repo before choosing it; nothing else uses one.
const BOOTSTRAP_LOCK_KEY = 891234567891;

type Mode = 'check' | 'apply';
type ProjectedResult = 'CREATE' | 'RECONCILE' | 'NO_CHANGES' | 'BLOCKED';

interface BootstrapConfig {
  target: string;
  databaseBranch: string;
  organizationName: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
}

interface UserMatch {
  id: string;
  organizationId: string;
  status: string;
  deletedAt: Date | null;
}

interface Diagnosis {
  organizations: { id: string; name: string }[];
  targetOrganizationId: string | null;
  userMatches: UserMatch[];
  userInTargetOrg: UserMatch | null;
  userInOtherOrg: UserMatch | null;
  adminRoleId: string | null;
  userHasAdminRole: boolean;
  existingPermissionKeys: string[];
  missingPermissionKeys: string[];
  result: ProjectedResult;
  reasons: string[];
}

function parseMode(argv: string[]): Mode {
  const hasCheck = argv.includes('--check');
  const hasApply = argv.includes('--apply');
  if (hasCheck === hasApply) {
    throw new Error('Pass exactly one of --check or --apply.');
  }
  return hasCheck ? 'check' : 'apply';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set.`);
  }
  return value.trim();
}

function loadConfig(): BootstrapConfig {
  const target = requireEnv('BOOTSTRAP_TARGET');
  const databaseBranch = requireEnv('BOOTSTRAP_DATABASE_BRANCH');
  const organizationName = requireEnv('BOOTSTRAP_ORGANIZATION_NAME');
  const adminFirstName = requireEnv('BOOTSTRAP_ADMIN_FIRST_NAME');
  const adminLastName = requireEnv('BOOTSTRAP_ADMIN_LAST_NAME');
  const rawEmail = requireEnv('BOOTSTRAP_ADMIN_EMAIL');
  const adminEmail = rawEmail.toLowerCase();

  if (!EMAIL_PATTERN.test(adminEmail)) {
    throw new Error(`BOOTSTRAP_ADMIN_EMAIL "${rawEmail}" is not a valid email address.`);
  }
  if (!adminEmail.endsWith(REQUIRED_EMAIL_DOMAIN)) {
    throw new Error(`BOOTSTRAP_ADMIN_EMAIL must end with "${REQUIRED_EMAIL_DOMAIN}".`);
  }

  // Redundant, human-asserted confirmation that the operator believes
  // DATABASE_URL points at the Neon `${target}` branch — a second,
  // independent signal on top of BOOTSTRAP_CONFIRM. This does NOT
  // technically verify which Neon branch DATABASE_URL actually is (a
  // Postgres connection string carries no queryable Neon branch name); it
  // only catches an operator who copy-pasted the wrong BOOTSTRAP_TARGET
  // without also updating this variable, or vice versa.
  if (databaseBranch.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `BOOTSTRAP_DATABASE_BRANCH ("${databaseBranch}") must equal BOOTSTRAP_TARGET ("${target}") — refusing to continue on a mismatch.`,
    );
  }

  return { target, databaseBranch, organizationName, adminEmail, adminFirstName, adminLastName };
}

function requireConfirmation(target: string): void {
  const expected = `CREATE_INITIAL_ADMIN_IN_${target.toUpperCase()}`;
  const actual = process.env.BOOTSTRAP_CONFIRM;
  if (actual !== expected) {
    throw new Error(
      `--apply requires BOOTSTRAP_CONFIRM="${expected}" (got ${actual ? 'a different value' : 'nothing'}).`,
    );
  }
}

async function diagnose(
  client: PrismaClient | Prisma.TransactionClient,
  config: BootstrapConfig,
): Promise<Diagnosis> {
  const organizations = await client.organization.findMany({
    where: { name: config.organizationName, deletedAt: null },
    select: { id: true, name: true },
  });

  if (organizations.length > 1) {
    return {
      organizations,
      targetOrganizationId: null,
      userMatches: [],
      userInTargetOrg: null,
      userInOtherOrg: null,
      adminRoleId: null,
      userHasAdminRole: false,
      existingPermissionKeys: [],
      missingPermissionKeys: [...ADMIN_PERMISSION_KEYS],
      result: 'BLOCKED',
      reasons: [
        `${organizations.length} organizations named "${config.organizationName}" already exist (ids: ${organizations
          .map((o) => o.id)
          .join(', ')}) — ambiguous target, resolve manually before retrying.`,
      ],
    };
  }

  const targetOrganizationId = organizations[0]?.id ?? null;

  const userMatches = await client.user.findMany({
    where: { email: { equals: config.adminEmail, mode: 'insensitive' } },
    select: { id: true, organizationId: true, status: true, deletedAt: true },
  });

  const userInTargetOrg = targetOrganizationId
    ? userMatches.find((u) => u.organizationId === targetOrganizationId) ?? null
    : null;
  const userInOtherOrg = userMatches.find((u) => u.organizationId !== targetOrganizationId) ?? null;

  if (userInOtherOrg) {
    return {
      organizations,
      targetOrganizationId,
      userMatches,
      userInTargetOrg,
      userInOtherOrg,
      adminRoleId: null,
      userHasAdminRole: false,
      existingPermissionKeys: [],
      missingPermissionKeys: [...ADMIN_PERMISSION_KEYS],
      result: 'BLOCKED',
      reasons: [
        `Email "${config.adminEmail}" already exists in a different organization (id: ${userInOtherOrg.organizationId}) — refusing to create a duplicate identity.`,
      ],
    };
  }

  if (userInTargetOrg?.deletedAt) {
    return {
      organizations,
      targetOrganizationId,
      userMatches,
      userInTargetOrg,
      userInOtherOrg: null,
      adminRoleId: null,
      userHasAdminRole: false,
      existingPermissionKeys: [],
      missingPermissionKeys: [...ADMIN_PERMISSION_KEYS],
      result: 'BLOCKED',
      reasons: [
        `User "${config.adminEmail}" exists but is soft-deleted (deletedAt=${userInTargetOrg.deletedAt.toISOString()}).`,
      ],
    };
  }

  if (userInTargetOrg && userInTargetOrg.status !== 'ACTIVE') {
    return {
      organizations,
      targetOrganizationId,
      userMatches,
      userInTargetOrg,
      userInOtherOrg: null,
      adminRoleId: null,
      userHasAdminRole: false,
      existingPermissionKeys: [],
      missingPermissionKeys: [...ADMIN_PERMISSION_KEYS],
      result: 'BLOCKED',
      reasons: [
        `User "${config.adminEmail}" exists but has status=${userInTargetOrg.status} — reactivation requires an explicit later decision, not performed by this script.`,
      ],
    };
  }

  let adminRoleId: string | null = null;
  let existingPermissionKeys: string[] = [];
  let userHasAdminRole = false;

  if (targetOrganizationId) {
    const adminRole = await client.role.findFirst({
      where: { organizationId: targetOrganizationId, name: ADMIN_ROLE_NAME },
      select: { id: true },
    });
    adminRoleId = adminRole?.id ?? null;

    if (adminRoleId) {
      const rolePermissions = await client.rolePermission.findMany({
        where: { roleId: adminRoleId },
        select: { permissionKey: true },
      });
      existingPermissionKeys = rolePermissions.map((rp) => rp.permissionKey);

      if (userInTargetOrg) {
        const assignment = await client.userRole.findUnique({
          where: { userId_roleId: { userId: userInTargetOrg.id, roleId: adminRoleId } },
        });
        userHasAdminRole = assignment !== null;
      }
    }
  }

  const missingPermissionKeys = ADMIN_PERMISSION_KEYS.filter((key) => !existingPermissionKeys.includes(key));

  let result: ProjectedResult;
  const reasons: string[] = [];
  if (!userInTargetOrg) {
    result = 'CREATE';
    reasons.push(
      targetOrganizationId
        ? 'Organization already exists; the user will be created.'
        : 'Neither the organization nor the user exist yet; both will be created.',
    );
  } else if (!adminRoleId || missingPermissionKeys.length > 0 || !userHasAdminRole) {
    result = 'RECONCILE';
    if (!adminRoleId) reasons.push('The ADMIN role does not exist yet in the target organization.');
    if (missingPermissionKeys.length > 0) {
      reasons.push(`${missingPermissionKeys.length} permission(s) missing from the ADMIN role.`);
    }
    if (!userHasAdminRole) reasons.push('The user exists but is not assigned the ADMIN role.');
  } else {
    result = 'NO_CHANGES';
    reasons.push('The user, the ADMIN role and every catalog permission are already fully in place.');
  }

  return {
    organizations,
    targetOrganizationId,
    userMatches,
    userInTargetOrg,
    userInOtherOrg: null,
    adminRoleId,
    userHasAdminRole,
    existingPermissionKeys,
    missingPermissionKeys,
    result,
    reasons,
  };
}

function printDiagnosis(config: BootstrapConfig, diagnosis: Diagnosis): void {
  console.log('=== bootstrap-admin --check (read-only) ===');
  console.log(`Target: ${config.target}`);
  console.log(`Declared database branch (human-asserted, not independently verified): ${config.databaseBranch}`);
  console.log(`Organization requested: "${config.organizationName}"`);
  console.log(
    diagnosis.organizations.length === 0
      ? '  -> not found (will be created on --apply)'
      : `  -> found ${diagnosis.organizations.length} match(es): ${diagnosis.organizations
          .map((o) => o.id)
          .join(', ')}`,
  );
  console.log(`Admin email requested (global, case-insensitive): ${config.adminEmail}`);
  if (diagnosis.userMatches.length === 0) {
    console.log('  -> no user found with that email in any organization');
  } else {
    for (const match of diagnosis.userMatches) {
      console.log(
        `  -> found user ${match.id} in organization ${match.organizationId} (status=${match.status}, deletedAt=${
          match.deletedAt ? match.deletedAt.toISOString() : 'null'
        })`,
      );
    }
  }
  console.log(`ADMIN role in target organization: ${diagnosis.adminRoleId ?? '(does not exist yet)'}`);
  console.log(`User currently assigned ADMIN role: ${diagnosis.userHasAdminRole}`);
  console.log(`Permissions already present on ADMIN role: ${diagnosis.existingPermissionKeys.length}/${ADMIN_PERMISSION_KEYS.length}`);
  console.log(`Permissions missing from ADMIN role: ${diagnosis.missingPermissionKeys.length}`);
  console.log(`\nProjected result: ${diagnosis.result}`);
  console.log('Reasons:');
  diagnosis.reasons.forEach((reason) => console.log(`  - ${reason}`));
}

async function runCheck(client: PrismaClient, config: BootstrapConfig): Promise<Diagnosis> {
  const diagnosis = await diagnose(client, config);
  printDiagnosis(config, diagnosis);
  if (diagnosis.result === 'BLOCKED') {
    process.exitCode = 1;
  }
  return diagnosis;
}

interface ApplyResult {
  userId: string;
  createdUser: boolean;
  generatedPassword: string | null;
  diagnosis: Diagnosis;
}

async function runApply(client: PrismaClient, config: BootstrapConfig): Promise<ApplyResult> {
  requireConfirmation(config.target);
  if (config.target.toLowerCase() === 'production') {
    throw new Error(
      'This phase only authorizes --apply against BOOTSTRAP_TARGET=staging. Production admin bootstrap requires separate, explicit authorization — see docs/production-blockers.md.',
    );
  }

  let generatedPassword: string | null = null;
  let createdUser = false;
  let userId = '';
  let finalDiagnosis!: Diagnosis;

  await client.$transaction(
    async (tx) => {
      const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY}::bigint) AS locked
      `;
      if (!lockRows[0]?.locked) {
        throw new Error('Another bootstrap-admin --apply run holds the lock — aborting to avoid a race.');
      }

      const diagnosis = await diagnose(tx, config);
      finalDiagnosis = diagnosis;
      if (diagnosis.result === 'BLOCKED') {
        throw new Error(`Blocked: ${diagnosis.reasons.join(' ')}`);
      }

      for (const permission of PERMISSION_CATALOG) {
        await tx.permission.upsert({
          where: { key: permission.key },
          create: permission,
          update: { description: permission.description },
        });
      }

      const organizationId =
        diagnosis.targetOrganizationId ??
        (await tx.organization.create({ data: { name: config.organizationName } })).id;

      const adminRoleId =
        diagnosis.adminRoleId ??
        (await tx.role.create({ data: { organizationId, name: ADMIN_ROLE_NAME } })).id;

      if (diagnosis.missingPermissionKeys.length > 0) {
        await tx.rolePermission.createMany({
          data: diagnosis.missingPermissionKeys.map((permissionKey) => ({ roleId: adminRoleId, permissionKey })),
          skipDuplicates: true,
        });
      }

      if (diagnosis.userInTargetOrg) {
        userId = diagnosis.userInTargetOrg.id;
      } else {
        generatedPassword = generateTemporaryPassword();
        const user = await tx.user.create({
          data: {
            organizationId,
            firstName: config.adminFirstName,
            lastName: config.adminLastName,
            email: config.adminEmail,
            passwordHash: await bcrypt.hash(generatedPassword, PASSWORD_HASH_ROUNDS),
            mustChangePassword: true,
          },
        });
        userId = user.id;
        createdUser = true;
      }

      if (!diagnosis.userHasAdminRole) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId, roleId: adminRoleId } },
          create: { userId, roleId: adminRoleId },
          update: {},
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: null,
          action: 'admin.bootstrap',
          entityType: 'User',
          entityId: userId,
          metadata: {
            target: config.target,
            mode: createdUser ? 'create' : 'reconcile',
            projectedResult: diagnosis.result,
          },
        },
      });
    },
    { timeout: 15_000 },
  );

  // Only reached after the transaction above has committed successfully —
  // the caller (printApplyResult / main) must never be handed
  // generatedPassword before this point.
  return { userId, createdUser, generatedPassword, diagnosis: finalDiagnosis };
}

function printApplyResult(config: BootstrapConfig, result: ApplyResult): void {
  console.log(`Bootstrap complete for ${config.adminEmail} in organization "${config.organizationName}".`);
  console.log(`User id: ${result.userId}`);
  if (result.createdUser && result.generatedPassword) {
    console.log('\nA new user was created. Temporary password (shown once — store it securely now):');
    console.log(result.generatedPassword);
    console.log('\nThe user must change this password on first login (mustChangePassword=true).');
  } else {
    console.log('Existing user reconciled — password left unchanged.');
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
      printApplyResult(config, result);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Guarded so importing this module (e.g. from bootstrap-admin.spec.ts) never
// triggers the CLI entry point or opens a PrismaClient — only running it
// directly (`ts-node prisma/bootstrap-admin.ts` / `npm run prisma:bootstrap-admin`)
// does.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  ADMIN_ROLE_NAME,
  BOOTSTRAP_LOCK_KEY,
  PASSWORD_HASH_ROUNDS,
  REQUIRED_EMAIL_DOMAIN,
  diagnose,
  loadConfig,
  parseMode,
  printApplyResult,
  printDiagnosis,
  requireConfirmation,
  requireEnv,
  runApply,
  runCheck,
};
export type { ApplyResult, BootstrapConfig, Diagnosis, ProjectedResult, UserMatch };
