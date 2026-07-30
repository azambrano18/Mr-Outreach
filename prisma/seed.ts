/**
 * Seed for the "postgres" persistence driver. This is NOT run
 * automatically: unlike the memory driver's DevSeedService (which seeds
 * on every boot), this script is invoked manually — `npm run prisma:seed`
 * — only once a real Development database is reachable. It refuses to run
 * against NODE_ENV=production as a safety net.
 *
 * Mirrors apps/api/src/modules/seed/permission-catalog.ts. Kept as a
 * plain duplicate rather than a cross-package import so this script has
 * no dependency on apps/api's NestJS-specific tsconfig (decorators,
 * path settings) — update both places together if the catalog changes.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const PASSWORD_HASH_ROUNDS = 10;

const PERMISSION_CATALOG = [
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
  { key: 'mailboxes.link', description: 'Fase 2.1: introspect and redeem a Railway mailbox-link token to link a mailbox.' },
  { key: 'mailboxes.refresh_status', description: "Fase 2.1: query the motor for a SERVER_TOKEN mailbox's current status." },
  { key: 'mailboxes.unlink', description: "Fase 2.1: revoke Mr Outreach's authorization to use a SERVER_TOKEN mailbox (owner/admin only)." },

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

  { key: 'clients.read.all', description: 'View every managed client in the organization.' },
  { key: 'clients.read.assigned', description: 'View only managed clients assigned to oneself.' },
  { key: 'clients.update', description: 'Edit a managed client.' },
  { key: 'clients.delete', description: 'Soft-delete (archive) a managed client.' },
  { key: 'clients.assign', description: 'Assign or reassign executives to a managed client.' },

  { key: 'domains.create', description: 'Register a domain under a managed client.' },
  { key: 'domains.read', description: 'View a domain and its accounts.' },
  { key: 'domains.update', description: 'Edit a domain.' },
  { key: 'domains.delete', description: 'Soft-delete (archive) a domain.' },

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
];

const ADMIN_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

// "Capacidades operativas del administrador" — kept as its own named list,
// mirroring apps/api/src/modules/seed/permission-catalog.ts, so the admin
// role's operational (Plantillas/Gestiones) permissions and the executive
// role's own list stay in sync from one source.
const TEMPLATE_AND_EXECUTION_OPERATIONAL_KEYS = [
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

const EXECUTIVE_PERMISSION_KEYS = [
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

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the development seed against NODE_ENV=production.');
  }

  const adminEmail = process.env.DEV_ADMIN_EMAIL ?? 'admin@local.test';
  const adminPassword = process.env.DEV_ADMIN_PASSWORD;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL ?? 'ejecutivo@local.test';
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD;

  if (!adminPassword || !executivePassword) {
    throw new Error('DEV_ADMIN_PASSWORD and DEV_EXECUTIVE_PASSWORD must be set to seed.');
  }

  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { description: permission.description },
    });
  }

  const organization = await prisma.organization.create({ data: { name: 'MejoReferido' } });

  const adminRole = await prisma.role.create({
    data: {
      organizationId: organization.id,
      name: 'ADMIN',
      rolePermissions: {
        create: ADMIN_PERMISSION_KEYS.map((permissionKey) => ({ permissionKey })),
      },
    },
  });
  const executiveRole = await prisma.role.create({
    data: {
      organizationId: organization.id,
      name: 'EXECUTIVE',
      rolePermissions: {
        create: EXECUTIVE_PERMISSION_KEYS.map((permissionKey) => ({ permissionKey })),
      },
    },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: organization.id,
      firstName: 'Administrador',
      lastName: '',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, PASSWORD_HASH_ROUNDS),
      userRoles: { create: { roleId: adminRole.id } },
    },
  });
  const executive = await prisma.user.create({
    data: {
      organizationId: organization.id,
      firstName: 'Ejecutivo',
      lastName: 'Demo',
      email: executiveEmail,
      passwordHash: await bcrypt.hash(executivePassword, PASSWORD_HASH_ROUNDS),
      userRoles: { create: { roleId: executiveRole.id } },
    },
  });

  console.log(
    `Seed complete: organization "${organization.name}", admin <${admin.email}>, executive <${executive.email}>.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
