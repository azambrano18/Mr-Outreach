/**
 * Fase 2 — opaque unit-of-work marker. Application services, use cases and
 * controllers only ever see this interface — never a Prisma type (never
 * `Prisma.TransactionClient`). Only the Prisma repository adapters under
 * infrastructure/persistence/prisma know what's actually inside one.
 *
 * Every repository write method involved in a transactional use case takes
 * an optional trailing `ctx?: TransactionContext` — when omitted, adapters
 * fall back to their own ambient connection (unchanged, non-transactional
 * behavior), exactly as today.
 */
export interface TransactionContext {
  readonly kind: string;
}

export interface TransactionManager {
  /**
   * Runs `work` atomically. Everything `work` awaits that threads the
   * given `ctx` through to repository calls commits or rolls back
   * together. Never call this from a controller — only from an
   * application-layer use case.
   */
  run<T>(work: (ctx: TransactionContext) => Promise<T>, options?: { timeoutMs?: number }): Promise<T>;
}
