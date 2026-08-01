/**
 * Seed for the "postgres" persistence driver. This is NOT run
 * automatically: unlike the memory driver's DevSeedService (which seeds
 * on every boot), this script is invoked manually — `npm run prisma:seed`
 * — only once a real Development database is reachable. It refuses to run
 * against NODE_ENV=production as a safety net. Development-only: never
 * enable it for production, never turn it into an admin-bootstrap tool
 * (see `prisma/bootstrap-admin.ts` for that, which is idempotent and
 * driven by BOOTSTRAP_* variables instead), and never run it against any
 * real Neon branch other than a developer's own local/dev database.
 *
 * Imports the real permission catalog directly instead of duplicating it
 * (as this file used to). The duplicate had already drifted once — it was
 * missing the `dev_tools.simulate_motor_events` key added later to the
 * real catalog — so the API, this seed, and `prisma/bootstrap-admin.ts`
 * now all consume exactly the same `PERMISSION_CATALOG`/
 * `ADMIN_PERMISSION_KEYS`/`EXECUTIVE_PERMISSION_KEYS`. Both files are
 * decorator-free plain data with only relative imports, so ts-node
 * compiles them with no dependency on apps/api's NestJS-specific tsconfig
 * (see the identical import in `prisma/bootstrap-admin.ts`).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  ADMIN_PERMISSION_KEYS,
  EXECUTIVE_PERMISSION_KEYS,
  PERMISSION_CATALOG,
} from '../apps/api/src/modules/seed/permission-catalog';

const PASSWORD_HASH_ROUNDS = 10;

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the development seed against NODE_ENV=production.');
  }

  const adminEmail = process.env.DEV_ADMIN_EMAIL ?? 'admin@local.test';
  const adminPassword = process.env.DEV_ADMIN_PASSWORD;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL ?? 'ejecutivo@local.test';
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD;

  if (!adminPassword || !executivePassword) {
    throw new Error('DEV_ADMIN_PASSWORD and DEV_EXECUTIVE_PASSWORD must be set to seed.');
  }

  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { description: permission.description },
    });
  }

  const organization = await prisma.organization.create({ data: { name: 'MejoReferido' } });

  const adminRole = await prisma.role.create({
    data: {
      organizationId: organization.id,
      name: 'ADMIN',
      rolePermissions: {
        create: ADMIN_PERMISSION_KEYS.map((permissionKey) => ({ permissionKey })),
      },
    },
  });
  const executiveRole = await prisma.role.create({
    data: {
      organizationId: organization.id,
      name: 'EXECUTIVE',
      rolePermissions: {
        create: EXECUTIVE_PERMISSION_KEYS.map((permissionKey) => ({ permissionKey })),
      },
    },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: organization.id,
      firstName: 'Administrador',
      lastName: '',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, PASSWORD_HASH_ROUNDS),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  const executive = await prisma.user.create({
    data: {
      organizationId: organization.id,
      firstName: 'Ejecutivo',
      lastName: 'Demo',
      email: executiveEmail,
      passwordHash: await bcrypt.hash(executivePassword, PASSWORD_HASH_ROUNDS),
      userRoles: { create: { roleId: executiveRole.id } },
    },
  });

  console.log(
    `Seed complete: organization "${organization.name}", admin <${admin.email}>, executive <${executive.email}>.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
