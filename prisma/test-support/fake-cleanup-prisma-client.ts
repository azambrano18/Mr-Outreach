/**
 * A minimal, hand-rolled, in-memory stand-in for the exact slice of the
 * Prisma Client API `prisma/cleanup-staging-test-data.ts` uses — not a
 * general Prisma mock, and deliberately NOT an extension of
 * `fake-prisma-client.ts` (that one models a completely different, much
 * smaller slice for bootstrap-admin/sync-system-roles; this script touches
 * ~35 tables, so a one-getter-per-model style would be mostly repetition).
 *
 * Every table the cleanup script deletes from is either scoped directly by
 * `organizationId` (the overwhelming majority — handled generically by
 * `buildOrgScoped`) or, for the three tables with no `organizationId` column
 * of their own (SignatureVersion, SequenceStepVersion,
 * SequenceTemplateVersion), scoped by a relation filter to their immediate
 * parent (handled generically by `buildRelationScoped`, keyed by the exact
 * relation-field name the real Prisma client uses — `signature`,
 * `sequenceStep`, `template` — so a query shape mismatch between this fake
 * and the real script would fail loudly instead of silently passing).
 *
 * `$transaction` snapshots the store before running the callback and
 * restores it if the callback throws — the same all-or-nothing guarantee a
 * real Postgres transaction gives, good enough to test rollback behaviour
 * without a real database.
 */
import { randomUUID } from 'node:crypto';

export interface FakeRow {
  [key: string]: unknown;
}

// Every table name exactly as the real script calls it (`client.<name>.x`).
const ORG_SCOPED_TABLES = [
  'conversationReadState',
  'conversationTagAssignment',
  'conversationNote',
  'conversationMessage',
  'conversation',
  'conversationTag',
  'scheduledEmail',
  'prospectImportRow',
  'sequenceStep',
  'sequenceContact',
  'prospectImport',
  'sequenceImportRow',
  'sequenceImport',
  'contact',
  'sequenceExecution',
  'sequenceTemplateStep',
  'sequenceTemplate',
  'company',
  'sequence',
  'signature',
  'signatureAsset',
  'emailBodyAsset',
  'integrationEvent',
  'integrationCommand',
  'clientExecutiveAssignment',
  'mailboxAssignment',
  'mailboxConnectionTest',
  'mailbox',
  'domain',
  'managedClient',
  'variable',
  'template',
] as const;

const RELATION_SCOPED_TABLES = [
  { table: 'sequenceStepVersion', relationField: 'sequenceStep', parentTable: 'sequenceStep', fkField: 'sequenceStepId' },
  { table: 'signatureVersion', relationField: 'signature', parentTable: 'signature', fkField: 'signatureId' },
  { table: 'sequenceTemplateVersion', relationField: 'template', parentTable: 'sequenceTemplate', fkField: 'templateId' },
] as const;

export type CleanupTableName = (typeof ORG_SCOPED_TABLES)[number] | (typeof RELATION_SCOPED_TABLES)[number]['table'];

export type FakeCleanupStore = Record<CleanupTableName, FakeRow[]> & {
  organization: FakeRow[];
  user: FakeRow[];
  role: FakeRow[];
  userRole: FakeRow[];
  auditLog: FakeRow[];
};

export function createEmptyCleanupStore(): FakeCleanupStore {
  const store = {} as FakeCleanupStore;
  for (const table of ORG_SCOPED_TABLES) store[table] = [];
  for (const { table } of RELATION_SCOPED_TABLES) store[table] = [];
  store.organization = [];
  store.user = [];
  store.role = [];
  store.userRole = [];
  store.auditLog = [];
  return store;
}

function pick(obj: FakeRow, select?: Record<string, boolean>): FakeRow {
  if (!select) return { ...obj };
  const result: FakeRow = {};
  for (const key of Object.keys(select)) {
    if (select[key]) result[key] = obj[key];
  }
  return result;
}

export class FakeCleanupPrismaClient {
  store: FakeCleanupStore;
  /** Call order log — lets tests assert the advisory lock runs first. */
  calls: string[] = [];
  /** Flip to false to simulate `pg_try_advisory_xact_lock` returning false. */
  lockAvailable = true;
  /** Set to a call name (e.g. 'user.deleteMany') to simulate that specific
   *  operation throwing mid-transaction, for rollback tests. */
  failOnCall: string | null = null;

  [modelName: string]: unknown;

  constructor(initial?: Partial<FakeCleanupStore>) {
    this.store = { ...createEmptyCleanupStore(), ...initial };

    for (const table of ORG_SCOPED_TABLES) {
      this[table] = this.buildOrgScoped(table);
    }
    for (const { table, relationField, parentTable, fkField } of RELATION_SCOPED_TABLES) {
      this[table] = this.buildRelationScoped(table, relationField, parentTable, fkField);
    }

    // mailbox additionally needs findMany (the script reads mailbox emails
    // before deleting them, for the post-commit asset purge).
    const mailboxOrgScoped = this.buildOrgScoped('mailbox');
    this.mailbox = {
      ...mailboxOrgScoped,
      findMany: async ({ where, select }: { where: { organizationId: string }; select?: Record<string, boolean> }) => {
        this.track('mailbox.findMany');
        return this.store.mailbox.filter((r) => r.organizationId === where.organizationId).map((r) => pick(r, select));
      },
    };

    this.organization = {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        this.track('organization.findUnique');
        const found = this.store.organization.find((o) => o.id === where.id);
        return found ? pick(found, select) : null;
      },
    };

    this.user = {
      findFirst: async ({
        where,
        select,
      }: {
        where: { email: { equals: string; mode: 'insensitive' } };
        select?: Record<string, boolean>;
      }) => {
        this.track('user.findFirst');
        const emailLower = where.email.equals.toLowerCase();
        const found = this.store.user.find((u) => (u.email as string).toLowerCase() === emailLower);
        return found ? pick(found, select) : null;
      },
      findMany: async ({
        where,
        select,
      }: {
        where: { organizationId: string; id: { notIn: string[] } };
        select?: Record<string, boolean>;
      }) => {
        this.track('user.findMany');
        return this.store.user
          .filter((u) => u.organizationId === where.organizationId && !where.id.notIn.includes(u.id as string))
          .map((u) => pick(u, select));
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        this.track('user.deleteMany');
        const before = this.store.user.length;
        this.store.user = this.store.user.filter((u) => !where.id.in.includes(u.id as string));
        return { count: before - this.store.user.length };
      },
    };

    this.userRole = {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; role: { name: string; organizationId: string } };
      }) => {
        this.track('userRole.findFirst');
        const matchingRoleIds = new Set(
          this.store.role
            .filter((r) => r.name === where.role.name && r.organizationId === where.role.organizationId)
            .map((r) => r.id as string),
        );
        return (
          this.store.userRole.find((ur) => ur.userId === where.userId && matchingRoleIds.has(ur.roleId as string)) ?? null
        );
      },
      deleteMany: async ({ where }: { where: { userId: { in: string[] } } }) => {
        this.track('userRole.deleteMany');
        const before = this.store.userRole.length;
        this.store.userRole = this.store.userRole.filter((ur) => !where.userId.in.includes(ur.userId as string));
        return { count: before - this.store.userRole.length };
      },
    };

    this.auditLog = {
      count: async ({ where }: { where: { organizationId: string } }) => {
        this.track('auditLog.count');
        return this.store.auditLog.filter((a) => a.organizationId === where.organizationId).length;
      },
      create: async ({ data }: { data: FakeRow }) => {
        this.track('auditLog.create');
        const row = { id: randomUUID(), createdAt: new Date(), ...data };
        this.store.auditLog.push(row);
        return row;
      },
    };
  }

  private track(name: string): void {
    this.calls.push(name);
    if (this.failOnCall === name) {
      throw new Error(`Simulated failure at ${name}`);
    }
  }

  private buildOrgScoped(table: CleanupTableName) {
    return {
      count: async ({ where }: { where: { organizationId: string } }) => {
        this.track(`${table}.count`);
        return this.store[table].filter((r) => r.organizationId === where.organizationId).length;
      },
      deleteMany: async ({ where }: { where: { organizationId: string } }) => {
        this.track(`${table}.deleteMany`);
        const before = this.store[table].length;
        this.store[table] = this.store[table].filter((r) => r.organizationId !== where.organizationId);
        return { count: before - this.store[table].length };
      },
    };
  }

  private buildRelationScoped(table: CleanupTableName, relationField: string, parentTable: CleanupTableName, fkField: string) {
    const resolveParentIds = (organizationId: string): Set<string> =>
      new Set(
        this.store[parentTable].filter((r) => r.organizationId === organizationId).map((r) => r.id as string),
      );
    return {
      count: async ({ where }: { where: Record<string, { organizationId: string }> }) => {
        this.track(`${table}.count`);
        const parentIds = resolveParentIds(where[relationField].organizationId);
        return this.store[table].filter((r) => parentIds.has(r[fkField] as string)).length;
      },
      deleteMany: async ({ where }: { where: Record<string, { organizationId: string }> }) => {
        this.track(`${table}.deleteMany`);
        const parentIds = resolveParentIds(where[relationField].organizationId);
        const before = this.store[table].length;
        this.store[table] = this.store[table].filter((r) => !parentIds.has(r[fkField] as string));
        return { count: before - this.store[table].length };
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
