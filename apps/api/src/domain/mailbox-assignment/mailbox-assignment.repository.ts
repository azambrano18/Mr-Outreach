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
  upsert(input: CreateMailboxAssignmentInput): Promise<MailboxAssignment>;
  remove(mailboxId: string, userId: string): Promise<void>;
  findByMailbox(mailboxId: string): Promise<MailboxAssignment[]>;
  findByUser(userId: string): Promise<MailboxAssignment[]>;
}
