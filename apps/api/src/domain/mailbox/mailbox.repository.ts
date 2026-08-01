import { TransactionContext } from '../persistence/transaction';
import { CreateLinkedMailboxInput, CreateMailboxInput, Mailbox, UpdateMailboxInput } from './mailbox.entity';

export interface MailboxRepository {
  findById(id: string, ctx?: TransactionContext): Promise<Mailbox | null>;
  /** Fase 2 (R2), §22 — the only lookup that DOES return an already-deleted mailbox; used exclusively by RetryMailboxAssetCleanupUseCase, since a deleted mailbox's failed R2 cleanup must still be retryable. */
  findByIdIncludingDeleted(id: string, ctx?: TransactionContext): Promise<Mailbox | null>;
  findByEmail(organizationId: string, email: string, ctx?: TransactionContext): Promise<Mailbox | null>;
  /** Fase 2.1 — lookup by the motor's own identifier, used to enforce "one Mr Outreach mailbox per serverMailboxId" before creating one. */
  findByServerMailboxId(serverMailboxId: string, ctx?: TransactionContext): Promise<Mailbox | null>;
  findAll(organizationId: string, ctx?: TransactionContext): Promise<Mailbox[]>;
  create(input: CreateMailboxInput, ctx?: TransactionContext): Promise<Mailbox>;
  /** Fase 2.1 — creates a SERVER_TOKEN mailbox (linkStatus ACTIVE), never touches imap/smtp columns. */
  createLinked(input: CreateLinkedMailboxInput, ctx?: TransactionContext): Promise<Mailbox>;
  update(id: string, input: UpdateMailboxInput, ctx?: TransactionContext): Promise<Mailbox>;
}
