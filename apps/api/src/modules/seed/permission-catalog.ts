import { Permission } from '../../domain/permission/permission.entity';

/**
 * The full system permission catalog. New permissions are added here as
 * later phases introduce the resources they gate (mailboxes, templates,
 * variables, signatures, audit) — this list is the single source of truth
 * both the memory seed and the Prisma seed load from.
 */
export const PERMISSION_CATALOG: Permission[] = [
  { key: 'users.read', description: 'View executives in the organization.' },
  { key: 'users.create', description: 'Create new executives.' },
  { key: 'users.update', description: 'Edit an executive.' },
  { key: 'users.disable', description: 'Activate or deactivate an executive.' },
  { key: 'users.reset_password', description: "Force-reset an executive's password." },

  { key: 'roles.read', description: 'View roles and their permissions.' },
  { key: 'roles.manage', description: 'Create roles and change their permissions.' },

  { key: 'mailboxes.read.all', description: 'View every mailbox in the organization.' },
  { key: 'mailboxes.read.assigned', description: 'View only mailboxes assigned to oneself.' },
  { key: 'mailboxes.create', description: 'Register a mailbox.' },
  { key: 'mailboxes.update', description: 'Edit mailbox configuration.' },
  { key: 'mailboxes.test', description: 'Run a connection test for a mailbox.' },
  { key: 'mailboxes.assign', description: 'Assign or reassign a mailbox to an executive.' },
  { key: 'mailboxes.disable', description: 'Deactivate a mailbox.' },
  {
    key: 'mailboxes.link',
    description: 'Fase 2.1: introspect and redeem a Railway mailbox-link token to link a mailbox.',
  },
  {
    key: 'mailboxes.refresh_status',
    description: "Fase 2.1: query the motor for a SERVER_TOKEN mailbox's current status.",
  },
  {
    key: 'mailboxes.unlink',
    description: 'Fase 2.1: revoke Mr Outreach\'s authorization to use a SERVER_TOKEN mailbox (owner/admin only).',
  },

  { key: 'templates.read', description: 'View templates.' },
  { key: 'templates.create', description: 'Create a template.' },
  { key: 'templates.update', description: 'Edit a template.' },
  { key: 'templates.duplicate', description: 'Duplicate a template.' },
  { key: 'templates.archive', description: 'Archive a template.' },
  { key: 'templates.delete', description: 'Soft-delete a template.' },

  { key: 'variables.read', description: 'View variable definitions.' },
  { key: 'variables.create', description: 'Create a variable definition.' },
  { key: 'variables.update', description: 'Edit a variable definition.' },
  { key: 'variables.archive', description: 'Archive a variable definition.' },
  { key: 'variables.delete', description: 'Permanently delete a never-used variable definition.' },

  { key: 'signatures.read', description: "View a mailbox's signature." },
  { key: 'signatures.create', description: 'Create a signature for a mailbox.' },
  { key: 'signatures.update', description: 'Edit a signature (creates a new version).' },
  { key: 'signatures.preview', description: 'Preview a signature with sample data.' },
  { key: 'signatures.activate', description: 'Activate a signature version.' },
  { key: 'signatures.archive', description: 'Archive a signature.' },
  { key: 'signatures.restore', description: 'Restore a previous signature version.' },
  { key: 'signatures.test', description: 'Send a test email using the signature.' },

  { key: 'audit.read', description: 'View the organization audit log.' },

  { key: 'sequences.create', description: 'Create or duplicate a sequence.' },
  { key: 'sequences.read', description: "View an executive's sequences." },
  { key: 'sequences.update', description: 'Edit a sequence (general info, sender account).' },
  { key: 'sequences.pause', description: 'Pause or resume a sequence.' },
  { key: 'sequences.archive', description: 'Archive or restore a sequence.' },
  { key: 'sequences.delete', description: 'Soft-delete a sequence, preserving sent history.' },
  {
    key: 'sequences.assign',
    description: "Create a sequence on another executive's behalf via the admin wizard.",
  },
  {
    key: 'sequences.reassign',
    description: 'Change which executive operationally owns an existing sequence.',
  },
  {
    key: 'sequences.read_all',
    description: 'View the global monitoring panel — every sequence across every executive.',
  },
  {
    key: 'sequences.cancel',
    description: 'Cancel every not-yet-sent job of a sequence without archiving it.',
  },
  {
    key: 'sequences.prospects.remove',
    description: "Remove a prospect from another executive's sequence (admin monitoring panel).",
  },
  {
    key: 'sequences.companies.remove',
    description: "Remove a company from another executive's sequence (admin monitoring panel).",
  },

  { key: 'sequence_steps.create', description: 'Create or duplicate a sequence step.' },
  { key: 'sequence_steps.read', description: 'View sequence steps, previews and versions.' },
  { key: 'sequence_steps.update', description: 'Edit or reorder a sequence step.' },
  { key: 'sequence_steps.delete', description: 'Delete a sequence step.' },
  { key: 'sequence_steps.test', description: 'Send a test email for a sequence step.' },

  {
    key: 'sequences.manage.own',
    description: 'Create, view and edit sequences one owns (self-service, under /me).',
  },
  {
    key: 'sequence_steps.manage.own',
    description: 'Create, view and edit steps of sequences one owns (self-service, under /me).',
  },

  // Client-hierarchy pivot: Organization (Mr Outreach's own tenant) vs
  // ManagedClient (the customer whose campaigns are operated here) — see
  // domain/client/managed-client.entity.ts. Same admin/self-service read
  // split already established for mailboxes (.read.all / .read.assigned).
  // A ManagedClient is only ever created via LinkMailboxUseCase (mailbox-link
  // token redemption) — there is no manual "create client" permission.
  { key: 'clients.read.all', description: 'View every managed client in the organization.' },
  { key: 'clients.read.assigned', description: 'View only managed clients assigned to oneself.' },
  { key: 'clients.update', description: 'Edit a managed client.' },
  { key: 'clients.delete', description: 'Soft-delete (archive) a managed client.' },
  { key: 'clients.assign', description: 'Assign or reassign executives to a managed client.' },

  // Domains inherit visibility from their parent client's assignment —
  // there is deliberately no domains.read.all/.read.assigned split (see
  // README): the MVP access model is client-level, with the architecture
  // left ready to add domain/mailbox-level granularity later.
  { key: 'domains.create', description: 'Register a domain under a managed client.' },
  { key: 'domains.read', description: 'View a domain and its accounts.' },
  { key: 'domains.update', description: 'Edit a domain.' },
  { key: 'domains.delete', description: 'Soft-delete (archive) a domain.' },

  // Centro de conversaciones — replaces the old "bandeja" concept.
  { key: 'conversations.read.all', description: 'View every conversation in the organization.' },
  {
    key: 'conversations.read.assigned',
    description: 'View only conversations for clients/mailboxes assigned to oneself.',
  },
  {
    key: 'conversations.update',
    description: 'Classify a conversation, add/remove tags, add internal notes.',
  },
  { key: 'conversations.assign', description: 'Assign a conversation to a responsible executive.' },
  { key: 'conversations.resolve', description: 'Mark a conversation as resolved, or reopen it.' },
  { key: 'conversations.archive', description: 'Archive a conversation.' },

  { key: 'conversation_tags.create', description: 'Create a conversation tag.' },
  { key: 'conversation_tags.read', description: 'View the organization conversation tags.' },
  { key: 'conversation_tags.update', description: 'Edit a conversation tag.' },
  { key: 'conversation_tags.delete', description: 'Delete a conversation tag.' },

  { key: 'conversation_notes.create', description: 'Add an internal note to a conversation.' },
  { key: 'conversation_notes.read', description: 'View internal notes on a conversation.' },
  { key: 'conversation_notes.update', description: 'Edit an internal note.' },
  { key: 'conversation_notes.delete', description: 'Delete an internal note.' },

  {
    key: 'unmatched_messages.read',
    description: 'View conversations pending manual classification ("Mensajes sin identificar").',
  },
  {
    key: 'unmatched_messages.associate',
    description: 'Manually associate or dismiss an unmatched conversation.',
  },

  // Mail-engine simulation phase (§52). mailboxes.create/.update, sequences.*,
  // audit.read and conversations.* above already cover the read/edit side of
  // these resources — the keys below gate only the NEW async command/event
  // actions this phase introduces (provisioning requests, publishing,
  // imports, sequence-scoped contact/company removal, and the integration
  // monitor), so nothing here duplicates an existing permission.
  { key: 'mailboxes.provision', description: 'Request and advance simulated mailbox provisioning.' },
  { key: 'sequences.publish', description: 'Publish a sequence, generating a new sequence version.' },
  { key: 'sequence_imports.create', description: 'Upload and submit a contact import for a sequence.' },
  { key: 'sequence_imports.read', description: 'View import status, mapping and validation results.' },
  { key: 'sequence_imports.cancel', description: 'Cancel a pending import.' },
  { key: 'sequence_contacts.read', description: "View a sequence's enrolled contacts and companies." },
  {
    key: 'sequence_contacts.remove',
    description: 'Remove a contact (or a whole company) from one sequence, cancelling its future jobs.',
  },
  {
    key: 'sequence_contacts.suppress',
    description: 'Add a contact or company to the global send-suppression list.',
  },
  { key: 'integration_commands.read', description: 'View the integration Outbox (commands) — Monitor de integración.' },
  { key: 'integration_commands.retry', description: 'Retry or manually advance a stuck/failed command.' },
  { key: 'integration_events.read', description: 'View the integration Inbox (events) — Monitor de integración.' },
  { key: 'integration_events.retry', description: 'Reprocess an integration event.' },
  {
    key: 'simulation.manage',
    description: 'Choose simulated scenarios and drive the Monitor de integración (simulation mode only).',
  },

  // Etapa "cuenta del ejecutivo" — Plantilla/Gestión. Distinct prefixes
  // (sequence_templates.*/sequence_executions.*) so these never collide
  // with the pre-existing, unrelated `templates.*` (canned-reply) or
  // `sequences.*` (legacy hybrid template+execution) resources.
  { key: 'sequence_templates.create_own', description: 'Create a Plantilla (reusable sequence content) for one of your own assigned mailboxes.' },
  { key: 'sequence_templates.read_own', description: 'View your own Plantillas.' },
  { key: 'sequence_templates.update_own', description: 'Edit your own Plantilla content, variables and scheduling.' },
  { key: 'sequence_templates.publish_own', description: 'Publish a new immutable version of your own Plantilla to the sequence-template motor.' },
  { key: 'sequence_templates.archive_own', description: 'Archive your own Plantilla.' },
  { key: 'sequence_templates.delete_own', description: 'Logically delete your own archived Plantilla (§11) — never a currently-published or DRAFT one.' },
  { key: 'sequence_executions.create_own', description: 'Create a Gestión (execution) from one of your own published Plantillas.' },
  { key: 'sequence_executions.read_own', description: 'View your own Gestiones.' },
  { key: 'sequence_executions.update_own', description: 'Edit your own Gestión while it is still DRAFT (§10) — never one already sent/accepted.' },
  { key: 'sequence_executions.delete_own', description: 'Delete your own Gestión while it is still DRAFT (§10) — never sends anything to the server.' },
  { key: 'sequence_executions.import_own', description: 'Upload and map a prospect file for your own Gestión.' },
  { key: 'sequence_executions.start_own', description: 'Submit your own Gestión to the sequence-execution motor.' },
  { key: 'sequence_executions.refresh_status_own', description: "Query the motor for your own Gestión's current status." },
  { key: 'sequence_executions.monitor_all', description: 'Read-only: view every Gestión in the organization (admin monitor).' },
  { key: 'sequence_executions.refresh_status_all', description: "Admin: query the motor for any executive's Gestión status." },

  // Dev-only tool — never reachable when SEQUENCE_MOTOR_MODE=http or in production (see DevSimulatedExecutionsController).
  {
    key: 'dev_tools.simulate_execution_state',
    description: 'Dev-only: force a Gestión into a simulated terminal/in-flight state for local visual validation (never a real motor call).',
  },

  // Dev-only tool — Fase "Recepción de eventos del motor" simulator. Never
  // reachable when SEQUENCE_MOTOR_MODE=http or in production (see
  // DevMotorEventsController). Distinct from dev_tools.simulate_execution_state:
  // that one mutates a SequenceExecution row directly, this one emits real
  // versioned MotorEvent envelopes through ProcessMotorEventUseCase.
  {
    key: 'dev_tools.simulate_motor_events',
    description: 'Dev-only: emit a versioned motor event (EXECUTION_ACCEPTED, OUTBOUND_MESSAGE_CREATED, etc.) through the same ingestion pipeline the real motor will use.',
  },
];

/**
 * "Capacidades operativas del administrador" — the admin role now also
 * operates as an executive (same permissions, same use cases, same
 * ownership-scoped rows) on top of its own administrative/monitoring
 * permissions. §26's original exclusion from ADMIN_PERMISSION_KEYS is
 * retired: this list is kept as one named source shared between
 * ADMIN_PERMISSION_KEYS (below, no longer filtered out) and
 * EXECUTIVE_PERMISSION_KEYS (spread in further down), purely so both role
 * definitions stay in sync. Access is governed entirely by these
 * permission keys plus row ownership (`ownerUserId`/`executiveId` = the
 * caller's own `user.id`, checked in SequenceTemplatesService/
 * SequenceExecutionsService) — never by a `role === 'EXECUTIVE'`
 * comparison, which does not exist anywhere in this codebase (see
 * PermissionsGuard; there is no RolesGuard at all).
 */
const TEMPLATE_AND_EXECUTION_OPERATIONAL_KEYS: string[] = [
  'sequence_templates.create_own',
  'sequence_templates.read_own',
  'sequence_templates.update_own',
  'sequence_templates.publish_own',
  'sequence_templates.archive_own',
  'sequence_templates.delete_own',
  'sequence_executions.create_own',
  'sequence_executions.read_own',
  'sequence_executions.update_own',
  'sequence_executions.delete_own',
  'sequence_executions.import_own',
  'sequence_executions.start_own',
  'sequence_executions.refresh_status_own',
];

/** Every permission in the catalog — the admin retains all administrative/monitoring permissions AND every operational one an executive has (see TEMPLATE_AND_EXECUTION_OPERATIONAL_KEYS's doc comment). */
export const ADMIN_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((p) => p.key);

export const EXECUTIVE_PERMISSION_KEYS: string[] = [
  'mailboxes.read.assigned',
  'templates.read',
  'signatures.read',
  'signatures.update',
  'signatures.preview',
  'signatures.test',
  'sequences.manage.own',
  'sequence_steps.manage.own',
  'clients.read.assigned',
  'domains.read',
  'conversations.read.assigned',
  'conversations.update',
  'conversations.assign',
  'conversations.resolve',
  'conversations.archive',
  'conversation_tags.read',
  'conversation_tags.create',
  'conversation_notes.create',
  'conversation_notes.read',
  'conversation_notes.update',
  'conversation_notes.delete',
  'unmatched_messages.read',
  'unmatched_messages.associate',
  'sequences.publish',
  'sequence_imports.create',
  'sequence_imports.read',
  'sequence_imports.cancel',
  'sequence_contacts.read',
  'sequence_contacts.remove',
  'sequence_contacts.suppress',
  ...TEMPLATE_AND_EXECUTION_OPERATIONAL_KEYS,
];
