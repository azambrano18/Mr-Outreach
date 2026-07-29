import { TransactionContext } from '../persistence/transaction';
import {
  ClientExecutiveAssignment,
  CreateClientExecutiveAssignmentInput,
} from './client-executive-assignment.entity';

export interface ClientExecutiveAssignmentRepository {
  upsert(input: CreateClientExecutiveAssignmentInput, ctx?: TransactionContext): Promise<ClientExecutiveAssignment>;
  remove(clientId: string, userId: string, ctx?: TransactionContext): Promise<void>;
  findByClient(clientId: string): Promise<ClientExecutiveAssignment[]>;
  findByUser(userId: string, ctx?: TransactionContext): Promise<ClientExecutiveAssignment[]>;
  /**
   * §10 — creates a MAILBOX_DERIVED/SECONDARY row ONLY if the executive has
   * no existing assignment (MANUAL or MAILBOX_DERIVED) for this client;
   * never updates or overwrites an existing row's role/source.
   */
  ensureDerivedVisibility(
    input: { organizationId: string; clientId: string; userId: string; assignedBy: string },
    ctx?: TransactionContext,
  ): Promise<void>;
  /** §10 — removes the row only if it exists and its visibilitySource is MAILBOX_DERIVED; a MANUAL row is left untouched. */
  removeDerivedVisibilityIfPresent(clientId: string, userId: string, ctx?: TransactionContext): Promise<void>;
}
