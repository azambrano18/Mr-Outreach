import { Injectable } from '@nestjs/common';
import { TransactionContext, TransactionManager } from '../../../domain/persistence/transaction';

/**
 * Fase 2 — memory mode has no real atomicity to offer (there is no
 * connection/lock to roll back), so this simply runs `work` with a
 * context every in-memory repository ignores. Unit tests and the
 * in-memory-mode demo keep working exactly as before; genuine rollback
 * behavior is only ever asserted against PostgreSQL (see
 * infrastructure/persistence/prisma's integration specs).
 */
class InMemoryTransactionContext implements TransactionContext {
  readonly kind = 'memory';
}

@Injectable()
export class InMemoryTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work(new InMemoryTransactionContext());
  }
}
