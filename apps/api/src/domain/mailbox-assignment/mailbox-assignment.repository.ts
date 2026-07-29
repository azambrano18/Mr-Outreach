import { TransactionContext } from '../persistence/transaction';
import { CreateMailboxAssignmentInput, MailboxAssignment } from './mailbox-assignment.entity';

/**
 * Owns the Mailbox<->User join used to hand an account to one or more
 * executives, now with a PRIMARY/SECONDARY role per assignment (Fase 9).
 * "Only one PRIMARY per mailbox" is NOT a database constraint — Prisma has
 * no portable partial-unique-index syntax across the schema DSL, and this
 * project has never applied a migration to a real database yet — so it is
 * enforced in MailboxesService.setAssignees() instead, the single place
 * that ever writes assignments.
 */
export interface MailboxAssignmentRepository {
  upsert(input: CreateMailboxAssignmentInput, ctx?: TransactionContext): Promise<MailboxAssignment>;
  remove(mailboxId: string, userId: string, ctx?: TransactionContext): Promise<void>;
  findByMailbox(mailboxId: string, ctx?: TransactionContext): Promise<MailboxAssignment[]>;
  findByUser(userId: string, ctx?: TransactionContext): Promise<MailboxAssignment[]>;
  /** §12.1 — one call for the admin listing page, instead of one findByMailbox() per row. */
  findAllByOrganization(organizationId: string): Promise<MailboxAssignment[]>;
}
