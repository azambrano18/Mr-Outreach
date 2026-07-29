/**
 * Same PRIMARY/SECONDARY shape as `MailboxAssignmentRole` (see
 * domain/mailbox-assignment/), reused here for consistency rather than
 * inventing a separate `assignment_role`/`is_primary` pair — one enum
 * covers both "who owns this client relationship" (PRIMARY) and "who else
 * is authorized" (SECONDARY).
 */
export type ClientAssignmentRole = 'PRIMARY' | 'SECONDARY';

/**
 * §10 — MANUAL: an admin explicitly granted this executive visibility on
 * the client (via Clientes > Asignar). MAILBOX_DERIVED: granted
 * automatically because the executive was assigned a mailbox belonging to
 * this client, with no prior MANUAL grant. Only a MAILBOX_DERIVED row is
 * ever auto-removed (when the executive loses their last mailbox for the
 * client) — a MANUAL row is never touched by mailbox assignment changes.
 */
export type ClientVisibilitySource = 'MANUAL' | 'MAILBOX_DERIVED';

export interface ClientExecutiveAssignment {
  id: string;
  organizationId: string;
  clientId: string;
  userId: string;
  role: ClientAssignmentRole;
  visibilitySource: ClientVisibilitySource;
  assignedBy: string;
  assignedAt: Date;
}

export interface CreateClientExecutiveAssignmentInput {
  organizationId: string;
  clientId: string;
  userId: string;
  role: ClientAssignmentRole;
  assignedBy: string;
  /** Defaults to MANUAL — every existing caller (admin "Asignar cliente" flow) is an explicit grant. */
  visibilitySource?: ClientVisibilitySource;
}
