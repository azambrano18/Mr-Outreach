export type MailboxAssignmentRole = 'PRIMARY' | 'SECONDARY';

export interface MailboxAssignment {
  id: string;
  organizationId: string;
  mailboxId: string;
  userId: string;
  role: MailboxAssignmentRole;
  assignedBy: string;
  assignedAt: Date;
}

export interface CreateMailboxAssignmentInput {
  organizationId: string;
  mailboxId: string;
  userId: string;
  role: MailboxAssignmentRole;
  assignedBy: string;
}
