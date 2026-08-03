/**
 * A minimal, hand-rolled, in-memory stand-in for the exact slice of the
 * Prisma Client API that `prisma/bootstrap-admin.ts` uses — not a general
 * Prisma mock. Lets `bootstrap-admin.spec.ts` exercise the real
 * `diagnose`/`runApply` logic (organization/user lookup, ADMIN role and
 * permission reconciliation, the advisory lock, transactional
 * commit/rollback) without ever opening a real Postgres connection.
 *
 * `$transaction` snapshots the store before running the callback and
 * restores it if the callback throws — the same all-or-nothing guarantee
 * a real Postgres transaction gives, good enough to test rollback
 * behaviour without a real database.
 */
import { randomUUID } from 'node:crypto';

export interface FakeOrganization {
  id: string;
  name: string;
  deletedAt: Date | null;
}

export interface FakeUser {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  status: string;
  mustChangePassword: boolean;
  deletedAt: Date | null;
}

export interface FakeRole {
  id: string;
  organizationId: string;
  name: string;
}

export interface FakePermission {
  key: string;
  description: string;
}

export interface FakeRolePermission {
  roleId: string;
  permissionKey: string;
}

export interface FakeUserRole {
  userId: string;
  roleId: string;
}

export interface FakeAuditLog {
  id?: string;
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt?: Date;
}

export interface FakeMailbox {
  id: string;
  organizationId: string;
  email: string;
  linkStatus: string;
  assetCleanupStatus: string;
  deletedAt: Date | null;
}

export interface FakeStore {
  organizations: FakeOrganization[];
  users: FakeUser[];
  roles: FakeRole[];
  permissions: FakePermission[];
  rolePermissions: FakeRolePermission[];
  userRoles: FakeUserRole[];
  auditLogs: FakeAuditLog[];
  mailboxes: FakeMailbox[];
}

export function createEmptyStore(): FakeStore {
  return {
    organizations: [],
    users: [],
    roles: [],
    permissions: [],
    rolePermissions: [],
    userRoles: [],
    auditLogs: [],
    mailboxes: [],
  };
}

function pick<T extends object>(obj: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...obj };
  const result: Partial<T> = {};
  for (const key of Object.keys(select) as (keyof T)[]) {
    if (select[key as string]) result[key] = obj[key];
  }
  return result;
}

export class FakePrismaClient {
  store: FakeStore;
  /** Call order log — lets tests assert the advisory lock runs first. */
  calls: string[] = [];
  /** Flip to false to simulate `pg_try_advisory_xact_lock` returning false. */
  lockAvailable = true;
  /** Set to a call name (e.g. 'auditLog.create') to simulate that specific
   *  operation throwing mid-transaction, for rollback tests. */
  failOnCall: string | null = null;

  constructor(initial?: Partial<FakeStore>) {
    this.store = { ...createEmptyStore(), ...initial };
  }

  /** Records the call and throws if it's the configured failure point. */
  private track(name: string): void {
    this.calls.push(name);
    if (this.failOnCall === name) {
      throw new Error(`Simulated failure at ${name}`);
    }
  }

  get organization() {
    return {
      findMany: async ({
        where,
        select,
      }: {
        where: { name: string; deletedAt: null };
        select?: Record<string, boolean>;
      }) => {
        this.track('organization.findMany');
        return this.store.organizations
          .filter((o) => o.name === where.name && o.deletedAt === null)
          .map((o) => pick(o, select));
      },
      create: async ({ data }: { data: { name: string } }) => {
        this.track('organization.create');
        const row: FakeOrganization = { id: randomUUID(), name: data.name, deletedAt: null };
        this.store.organizations.push(row);
        return row;
      },
    };
  }

  get user() {
    return {
      findMany: async ({
        where,
        select,
      }: {
        where: { email: { equals: string; mode: 'insensitive' } };
        select?: Record<string, boolean>;
      }) => {
        this.track('user.findMany');
        const emailLower = where.email.equals.toLowerCase();
        return this.store.users.filter((u) => u.email.toLowerCase() === emailLower).map((u) => pick(u, select));
      },
      create: async ({
        data,
      }: {
        data: {
          organizationId: string;
          firstName: string;
          lastName: string;
          email: string;
          passwordHash: string;
          status?: string;
          mustChangePassword?: boolean;
        };
      }) => {
        this.track('user.create');
        const row: FakeUser = {
          id: randomUUID(),
          organizationId: data.organizationId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          passwordHash: data.passwordHash,
          status: data.status ?? 'ACTIVE',
          mustChangePassword: data.mustChangePassword ?? false,
          deletedAt: null,
        };
        this.store.users.push(row);
        return row;
      },
    };
  }

  get role() {
    return {
      findFirst: async ({
        where,
        select,
      }: {
        where: { organizationId: string; name: string };
        select?: Record<string, boolean>;
      }) => {
        this.track('role.findFirst');
        const found = this.store.roles.find((r) => r.organizationId === where.organizationId && r.name === where.name);
        return found ? pick(found, select) : null;
      },
      create: async ({ data }: { data: { organizationId: string; name: string } }) => {
        this.track('role.create');
        const row: FakeRole = { id: randomUUID(), organizationId: data.organizationId, name: data.name };
        this.store.roles.push(row);
        return row;
      },
    };
  }

  get permission() {
    return {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: { key: string; description: string };
        update: { description: string };
      }) => {
        this.track('permission.upsert');
        const existing = this.store.permissions.find((p) => p.key === where.key);
        if (existing) {
          existing.description = update.description;
          return existing;
        }
        const row: FakePermission = { key: create.key, description: create.description };
        this.store.permissions.push(row);
        return row;
      },
      findMany: async ({ select }: { select?: Record<string, boolean> } = {}) => {
        this.track('permission.findMany');
        return this.store.permissions.map((p) => pick(p, select));
      },
      createMany: async ({
        data,
      }: {
        data: { key: string; description: string }[];
        skipDuplicates?: boolean;
      }) => {
        this.track('permission.createMany');
        let count = 0;
        for (const entry of data) {
          if (!this.store.permissions.some((p) => p.key === entry.key)) {
            this.store.permissions.push({ key: entry.key, description: entry.description });
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  get rolePermission() {
    return {
      findMany: async ({ where, select }: { where: { roleId: string }; select?: Record<string, boolean> }) => {
        this.track('rolePermission.findMany');
        return this.store.rolePermissions.filter((rp) => rp.roleId === where.roleId).map((rp) => pick(rp, select));
      },
      createMany: async ({
        data,
      }: {
        data: { roleId: string; permissionKey: string }[];
        skipDuplicates?: boolean;
      }) => {
        this.track('rolePermission.createMany');
        let count = 0;
        for (const entry of data) {
          const exists = this.store.rolePermissions.some(
            (rp) => rp.roleId === entry.roleId && rp.permissionKey === entry.permissionKey,
          );
          if (!exists) {
            this.store.rolePermissions.push({ roleId: entry.roleId, permissionKey: entry.permissionKey });
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  get userRole() {
    return {
      findUnique: async ({ where }: { where: { userId_roleId: { userId: string; roleId: string } } }) => {
        this.track('userRole.findUnique');
        const { userId, roleId } = where.userId_roleId;
        return this.store.userRoles.find((ur) => ur.userId === userId && ur.roleId === roleId) ?? null;
      },
      upsert: async ({
        where,
        create,
      }: {
        where: { userId_roleId: { userId: string; roleId: string } };
        create: { userId: string; roleId: string };
        update: Record<string, never>;
      }) => {
        this.track('userRole.upsert');
        const { userId, roleId } = where.userId_roleId;
        const existing = this.store.userRoles.find((ur) => ur.userId === userId && ur.roleId === roleId);
        if (existing) return existing;
        const row: FakeUserRole = { userId: create.userId, roleId: create.roleId };
        this.store.userRoles.push(row);
        return row;
      },
    };
  }

  get auditLog() {
    return {
      create: async ({ data }: { data: FakeAuditLog }) => {
        this.track('auditLog.create');
        const row: FakeAuditLog = { id: randomUUID(), createdAt: new Date(), ...data };
        this.store.auditLogs.push(row);
        return row;
      },
      findMany: async ({
        where,
        select,
      }: {
        where?: { action?: string; entityType?: string };
        select?: Record<string, boolean>;
      } = {}) => {
        this.track('auditLog.findMany');
        return this.store.auditLogs
          .filter(
            (a) =>
              (where?.action === undefined || a.action === where.action) &&
              (where?.entityType === undefined || a.entityType === where.entityType),
          )
          .map((a) => pick(a, select));
      },
    };
  }

  get mailbox() {
    return {
      findUnique: async ({ where }: { where: { id: string } }) => {
        this.track('mailbox.findUnique');
        return this.store.mailboxes.find((m) => m.id === where.id) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeMailbox> }) => {
        this.track('mailbox.update');
        const existing = this.store.mailboxes.find((m) => m.id === where.id);
        if (!existing) {
          throw new Error(`Fake mailbox ${where.id} not found.`);
        }
        Object.assign(existing, data);
        return existing;
      },
    };
  }

  $queryRaw = async (_strings: TemplateStringsArray, ..._values: unknown[]): Promise<{ locked: boolean }[]> => {
    this.track('$queryRaw:advisory_lock');
    return [{ locked: this.lockAvailable }];
  };

  $transaction = async <T>(callback: (tx: this) => Promise<T>, _opts?: { timeout?: number }): Promise<T> => {
    const snapshot = structuredClone(this.store);
    try {
      return await callback(this);
    } catch (error) {
      this.store = snapshot;
      throw error;
    }
  };

  $disconnect = async (): Promise<void> => {};
}
