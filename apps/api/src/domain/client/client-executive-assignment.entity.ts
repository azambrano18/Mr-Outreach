/**
 * Same PRIMARY/SECONDARY shape as `MailboxAssignmentRole` (see
 * domain/mailbox-assignment/), reused here for consistency rather than
 * inventing a separate `assignment_role`/`is_primary` pair — one enum
 * covers both "who owns this client relationship" (PRIMARY) and "who else
 * is authorized" (SECONDARY).
 */
export type ClientAssignmentRole = 'PRIMARY' | 'SECONDARY';

export interface ClientExecutiveAssignment {
  id: string;
  organizationId: string;
  clientId: string;
  userId: string;
  role: ClientAssignmentRole;
  assignedBy: string;
  assignedAt: Date;
}

export interface CreateClientExecutiveAssignmentInput {
  organizationId: string;
  clientId: string;
  userId: string;
  role: ClientAssignmentRole;
  assignedBy: string;
}
