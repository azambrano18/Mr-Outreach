import { PrismaService } from './prisma.service';

/**
 * Shared parent-row fixtures for Prisma contract specs, run against a
 * single shared remote test database (mr-outreach-test on Neon) rather
 * than a disposable per-run container. Two independent id namespaces:
 *
 * - 'org_1'/'org_2' ("legacy"): used by the pre-existing contract specs
 *   (mailbox/signature/role/template/user/variable), which predate Fase 1
 *   and assert *exact* row counts scoped to these ids (e.g.
 *   `expect(orgOneMailboxes).toHaveLength(1)`). These specs were always
 *   skipped before Fase 1 (no TEST_DATABASE_URL ever configured) so this
 *   FK/count interaction was never actually exercised until now.
 * - 'fx_*' ("fixture"): used by the Fase 1 contract specs (Company/
 *   Contact/SequenceImport/SequenceImportRow/SequenceContact/
 *   ScheduledEmail/IntegrationCommand/IntegrationEvent), which need a
 *   fuller FK chain (managed client, user, mailbox, sequence, step). A
 *   separate namespace avoids ever perturbing the legacy specs' counts.
 *
 * Every `seed*` function is idempotent (`skipDuplicates: true`). Run these
 * files with `--runInBand` (see package.json's `test:integration` script)
 * so Jest doesn't run them in parallel workers against the same live rows.
 */
export async function seedOrganizations(prisma: PrismaService): Promise<void> {
  await prisma.organization.createMany({
    data: [
      { id: 'org_1', name: 'Org 1' },
      { id: 'org_2', name: 'Org 2' },
    ],
    skipDuplicates: true,
  });
}

/**
 * mailbox_1/mailbox_org2 under the legacy org_1/org_2 — used only by
 * prisma-signature.repository.contract.spec.ts. Deliberately NOT deleted
 * by that spec's per-test reset() (signature's own Signature rows are what
 * get reset), but IS deleted in that spec's `afterAll` — this is the one
 * row pair that both the mailbox spec (which asserts an exact per-org
 * mailbox count) and the signature spec (which needs a stable mailbox FK
 * target) touch, so signature must leave no trace once its file finishes.
 */
export async function seedLegacyMailboxForSignature(prisma: PrismaService): Promise<void> {
  await prisma.mailbox.createMany({
    data: [
      { id: 'mailbox_1', organizationId: 'org_1', name: 'Mailbox 1', email: 'mailbox1@example.com', fromName: 'Mailbox One', ...imapSmtpDefaults },
      { id: 'mailbox_org2', organizationId: 'org_2', name: 'Mailbox Org2', email: 'mailbox-org2@example.com', fromName: 'Mailbox Org2', ...imapSmtpDefaults },
    ],
    skipDuplicates: true,
  });
}

/** Permission catalog rows referenced by role-repository.contract.ts's RolePermission FK — a global, non-org-scoped catalog. */
export async function seedPermissions(prisma: PrismaService): Promise<void> {
  await prisma.permission.createMany({
    data: [
      { key: 'users.read', description: 'Read users' },
      { key: 'users.create', description: 'Create users' },
      { key: 'templates.read', description: 'Read templates' },
      { key: 'mailboxes.read.assigned', description: 'Read assigned mailboxes' },
    ],
    skipDuplicates: true,
  });
}

export async function seedFixtureOrganizations(prisma: PrismaService): Promise<void> {
  await prisma.organization.createMany({
    data: [
      { id: 'fx_org_1', name: 'Fixture Org 1' },
      { id: 'fx_org_2', name: 'Fixture Org 2' },
    ],
    skipDuplicates: true,
  });
}

/** ManagedClient rows for the Company/Contact/SequenceImport family of contract tests. */
export async function seedManagedClients(prisma: PrismaService): Promise<void> {
  await prisma.managedClient.createMany({
    data: [
      { id: 'fx_client_1', organizationId: 'fx_org_1', serverClientId: 'srv_fx_101', name: 'Fixture Client 1', createdBy: 'seed', updatedBy: 'seed' },
      { id: 'fx_client_2', organizationId: 'fx_org_1', serverClientId: 'srv_fx_102', name: 'Fixture Client 2', createdBy: 'seed', updatedBy: 'seed' },
      { id: 'fx_client_org2', organizationId: 'fx_org_2', serverClientId: 'srv_fx_103', name: 'Fixture Client Org2', createdBy: 'seed', updatedBy: 'seed' },
    ],
    skipDuplicates: true,
  });
}

/** A minimal User row per organization — needed as Sequence.executiveId's FK target. */
export async function seedUsers(prisma: PrismaService): Promise<void> {
  await prisma.user.createMany({
    data: [
      { id: 'fx_user_1', organizationId: 'fx_org_1', firstName: 'Fixture', lastName: 'Exec One', email: 'fx-exec1@example.com', passwordHash: 'x' },
      { id: 'fx_user_org2', organizationId: 'fx_org_2', firstName: 'Fixture', lastName: 'Exec Org2', email: 'fx-exec-org2@example.com', passwordHash: 'x' },
    ],
    skipDuplicates: true,
  });
}

const imapSmtpDefaults = {
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapEncryption: 'SSL_TLS' as const,
  imapUsername: 'user',
  imapSecretCiphertext: 'iv.tag.cipher',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpEncryption: 'SSL_TLS' as const,
  smtpUsername: 'user',
  smtpSecretCiphertext: 'iv.tag.cipher',
};

/** A minimal Mailbox row per organization — needed as Sequence/SequenceImport/ScheduledEmail's FK target. */
export async function seedMailboxes(prisma: PrismaService): Promise<void> {
  await prisma.mailbox.createMany({
    data: [
      { id: 'fx_mailbox_1', organizationId: 'fx_org_1', name: 'Fixture Mailbox 1', email: 'fx-mailbox1@example.com', fromName: 'Fixture Mailbox One', ...imapSmtpDefaults },
      { id: 'fx_mailbox_org2', organizationId: 'fx_org_2', name: 'Fixture Mailbox Org2', email: 'fx-mailbox-org2@example.com', fromName: 'Fixture Mailbox Org2', ...imapSmtpDefaults },
    ],
    skipDuplicates: true,
  });
}

/** A minimal Sequence row per organization — needed as SequenceImport/SequenceContact/ScheduledEmail's FK target. */
export async function seedSequences(prisma: PrismaService): Promise<void> {
  await prisma.sequence.createMany({
    data: [
      { id: 'fx_sequence_1', organizationId: 'fx_org_1', executiveId: 'fx_user_1', mailboxId: 'fx_mailbox_1', name: 'Fixture Sequence 1', timezone: 'America/Santiago', createdBy: 'seed', updatedBy: 'seed' },
      { id: 'fx_sequence_org2', organizationId: 'fx_org_2', executiveId: 'fx_user_org2', mailboxId: 'fx_mailbox_org2', name: 'Fixture Sequence Org2', timezone: 'America/Santiago', createdBy: 'seed', updatedBy: 'seed' },
    ],
    skipDuplicates: true,
  });
}

/** A minimal PUBLISHED SequenceStep — needed as ScheduledEmail.sequenceStepId's FK target. */
export async function seedSequenceSteps(prisma: PrismaService): Promise<void> {
  await prisma.sequenceStep.createMany({
    data: [
      {
        id: 'fx_step_1',
        organizationId: 'fx_org_1',
        sequenceId: 'fx_sequence_1',
        position: 1,
        name: 'Fixture Step 1',
        subject: 'Subject',
        htmlBody: '<p>hi</p>',
        plainTextBody: 'hi',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
        status: 'PUBLISHED',
        createdBy: 'seed',
        updatedBy: 'seed',
      },
    ],
    skipDuplicates: true,
  });
}

/** A minimal Contact row — needed by sequence-import-row-repository.contract.ts's contactId FK. */
export async function seedContacts(prisma: PrismaService): Promise<void> {
  await prisma.contact.createMany({
    data: [
      { id: 'fx_contact_1', organizationId: 'fx_org_1', clientId: 'fx_client_1', email: 'fx-contact1@example.com' },
    ],
    skipDuplicates: true,
  });
}

/** A minimal SequenceImport row — the FK target for sequence-import-row-repository.contract.ts's importId. */
export async function seedSequenceImportForRows(prisma: PrismaService): Promise<void> {
  await prisma.sequenceImport.upsert({
    where: { id: 'fx_import_1' },
    create: {
      id: 'fx_import_1',
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      sequenceId: 'fx_sequence_1',
      executiveId: 'fx_user_1',
      mailboxId: 'fx_mailbox_1',
      fileName: 'contacts.xlsx',
      storageKey: 'import_fixture',
      checksum: 'deadbeef',
      totalRows: 2,
      createdBy: 'fx_user_1',
    },
    update: {},
  });
}

/** A minimal SequenceContact row — the FK target for scheduled-email-repository.contract.ts. */
export async function seedSequenceContactForScheduledEmails(prisma: PrismaService): Promise<void> {
  await prisma.sequenceContact.upsert({
    where: { id: 'fx_seqcontact_1' },
    create: {
      id: 'fx_seqcontact_1',
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      sequenceId: 'fx_sequence_1',
      sequenceVersion: 1,
      contactId: 'fx_contact_1',
      assignedMailboxId: 'fx_mailbox_1',
      assignedExecutiveId: 'fx_user_1',
      currentStepId: 'fx_step_1',
      currentStepPosition: 1,
    },
    update: {},
  });
}

/** Full fixture chain (organizations -> managed clients -> users -> mailboxes -> sequences -> steps). */
export async function seedFullChain(prisma: PrismaService): Promise<void> {
  await seedFixtureOrganizations(prisma);
  await seedManagedClients(prisma);
  await seedUsers(prisma);
  await seedMailboxes(prisma);
  await seedSequences(prisma);
  await seedSequenceSteps(prisma);
}
