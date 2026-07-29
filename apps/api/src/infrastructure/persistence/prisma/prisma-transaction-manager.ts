import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransactionContext, TransactionManager } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';

/** Fase 2 — the only place in the codebase allowed to hold a `Prisma.TransactionClient`. */
export class PrismaTransactionContext implements TransactionContext {
  readonly kind = 'prisma';
  constructor(public readonly tx: Prisma.TransactionClient) {}
}

@Injectable()
export class PrismaTransactionManager implements TransactionManager {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(work: (ctx: TransactionContext) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    return this.prisma.$transaction((tx) => work(new PrismaTransactionContext(tx)), {
      // maxWait: time allowed to acquire a connection from the pool before
      // giving up. timeout: max transaction duration — 10s default, raised
      // per-call for the import use case (see confirm-prospect-import).
      maxWait: 10_000,
      timeout: options?.timeoutMs ?? 10_000,
    });
  }
}

/**
 * Every Prisma repository resolves its working client through this helper
 * instead of always reading `this.prisma` directly — keeps the
 * `instanceof` check (and therefore the only import of
 * `PrismaTransactionContext`'s concrete type) in one place.
 */
/**
 * Fase 2 — lets a transactional use case detect "this failed because of a
 * genuine concurrent race on a unique constraint" (e.g. two simultaneous
 * requests with the same Idempotency-Key both trying to create the same
 * Domain/Mailbox row before either has committed) without importing any
 * Prisma type into the application layer — only a boolean.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function resolveClient(
  prisma: PrismaService,
  ctx?: TransactionContext,
): PrismaService | Prisma.TransactionClient {
  return ctx instanceof PrismaTransactionContext ? ctx.tx : prisma;
}
