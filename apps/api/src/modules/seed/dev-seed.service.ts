import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { ResponseOutcome } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { OrganizationRepository } from '../../domain/organization/organization.repository';
import { PermissionRepository } from '../../domain/permission/permission.repository';
import { RoleRepository } from '../../domain/role/role.repository';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContact, SequenceContactStatus } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { Sequence, SequencePublishStatus } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { generateSequenceName } from '../../application/sequences/sequence-timing.util';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { TemplateRepository } from '../../domain/template/template.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import { VariableRepository } from '../../domain/variable/variable.repository';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { MockEngineClient } from '../../infrastructure/engine/mock/mock-engine-client';
import {
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  ORGANIZATION_REPOSITORY,
  PERMISSION_REPOSITORY,
  ROLE_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SEQUENCE_STEP_VERSION_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  TEMPLATE_REPOSITORY,
  USER_REPOSITORY,
  USER_ROLE_REPOSITORY,
  VARIABLE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import {
  ADMIN_PERMISSION_KEYS,
  EXECUTIVE_PERMISSION_KEYS,
  PERMISSION_CATALOG,
} from './permission-catalog';

const PASSWORD_HASH_ROUNDS = 10;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Only ever seeds when PERSISTENCE_DRIVER=memory. Runs once, at process
 * boot — there is nothing to seed for the postgres driver here: real
 * environments are seeded deliberately via `prisma/seed.ts`, never
 * automatically on every boot (see README > "Migraciones").
 */
@Injectable()
export class DevSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DevSeedService.name);

  constructor(
    private readonly config: AppConfigService,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepository,
    @Inject(USER_ROLE_REPOSITORY) private readonly userRoles: UserRoleRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY)
    private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(TEMPLATE_REPOSITORY) private readonly templates: TemplateRepository,
    @Inject(VARIABLE_REPOSITORY) private readonly variables: VariableRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY)
    private readonly signatureVersions: SignatureVersionRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly sequenceSteps: SequenceStepRepository,
    @Inject(SEQUENCE_STEP_VERSION_REPOSITORY)
    private readonly sequenceStepVersions: SequenceStepVersionRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly clientAssignments: ClientExecutiveAssignmentRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CONVERSATION_MESSAGE_REPOSITORY)
    private readonly conversationMessages: ConversationMessageRepository,
    private readonly secrets: SecretEncryptionService,
    private readonly mockEngine: MockEngineClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.persistenceDriver !== 'memory') {
      return;
    }

    await this.permissions.upsertMany(PERMISSION_CATALOG);

    const organization = await this.organizations.create({ name: 'MejoReferido' });

    const adminRole = await this.roles.create({
      organizationId: organization.id,
      name: 'ADMIN',
      permissionKeys: ADMIN_PERMISSION_KEYS,
    });
    const executiveRole = await this.roles.create({
      organizationId: organization.id,
      name: 'EXECUTIVE',
      permissionKeys: EXECUTIVE_PERMISSION_KEYS,
    });

    const admin = await this.users.create({
      organizationId: organization.id,
      firstName: 'Administrador',
      lastName: '',
      email: this.config.devAdminEmail,
      passwordHash: await bcrypt.hash(this.config.devAdminPassword!, PASSWORD_HASH_ROUNDS),
    });
    await this.userRoles.assign(admin.id, adminRole.id);

    const executive = await this.users.create({
      organizationId: organization.id,
      firstName: 'Ejecutivo',
      lastName: 'Demo',
      email: this.config.devExecutiveEmail,
      passwordHash: await bcrypt.hash(this.config.devExecutivePassword!, PASSWORD_HASH_ROUNDS),
    });
    await this.userRoles.assign(executive.id, executiveRole.id);

    // Extra visual-demo-only executives, so the executives table isn't a
    // single row: not meant to be logged into (their password is a random
    // value discarded immediately, never logged, never documented), only
    // to show search/filter/active-inactive states with real-looking data.
    // Clearly tagged "(Demo)" in the name per the interface review request.
    const secondExecutive = await this.users.create({
      organizationId: organization.id,
      firstName: 'Fernanda',
      lastName: 'Rojas (Demo)',
      email: 'demo.fernanda@local.test',
      passwordHash: await bcrypt.hash(randomUUID(), PASSWORD_HASH_ROUNDS),
    });
    await this.userRoles.assign(secondExecutive.id, executiveRole.id);

    const thirdExecutive = await this.users.create({
      organizationId: organization.id,
      firstName: 'Roberto',
      lastName: 'Díaz (Demo)',
      email: 'demo.roberto@local.test',
      passwordHash: await bcrypt.hash(randomUUID(), PASSWORD_HASH_ROUNDS),
      status: 'INACTIVE',
    });
    await this.userRoles.assign(thirdExecutive.id, executiveRole.id);

    // Demo-only mailboxes: fake, non-routable-looking hosts so nobody
    // mistakes them for a real account to connect to. ENGINE_DRIVER=mock
    // means no real IMAP/SMTP connection is ever attempted against them.
    const salesMailbox = await this.mailboxes.create({
      organizationId: organization.id,
      name: 'Ventas (Demo)',
      email: 'ventas.demo@mejoreferido-demo.test',
      fromName: 'Equipo de Ventas',
      replyTo: null,
      imap: {
        host: 'imap.demo.mejoreferido-demo.test',
        port: 993,
        encryption: 'SSL_TLS',
        username: 'ventas.demo@mejoreferido-demo.test',
        verifyCertificate: true,
        secretCiphertext: this.secrets.encrypt(randomUUID()),
      },
      smtp: {
        host: 'smtp.demo.mejoreferido-demo.test',
        port: 587,
        encryption: 'STARTTLS',
        username: 'ventas.demo@mejoreferido-demo.test',
        verifyCertificate: true,
        secretCiphertext: this.secrets.encrypt(randomUUID()),
      },
    });

    const inactiveMailbox = await this.mailboxes.create({
      organizationId: organization.id,
      name: 'Soporte (Demo, inactivo)',
      email: 'soporte.demo@mejoreferido-demo.test',
      fromName: 'Equipo de Soporte',
      replyTo: null,
      imap: {
        host: 'imap.demo.mejoreferido-demo.test',
        port: 993,
        encryption: 'SSL_TLS',
        username: 'soporte.demo@mejoreferido-demo.test',
        verifyCertificate: true,
        secretCiphertext: this.secrets.encrypt(randomUUID()),
      },
      smtp: {
        host: 'smtp.demo.mejoreferido-demo.test',
        port: 587,
        encryption: 'STARTTLS',
        username: 'soporte.demo@mejoreferido-demo.test',
        verifyCertificate: true,
        secretCiphertext: this.secrets.encrypt(randomUUID()),
      },
    });
    await this.mailboxes.update(inactiveMailbox.id, { status: 'INACTIVE' });

    // Marks the sales mailbox as already connection-tested — otherwise a
    // fresh seed would show it as "no operativa" everywhere a sequence's
    // readiness check looks at it (SequencesService.buildSenderAccountInfo),
    // which would make the demo sequence below look permanently broken.
    await this.mailboxes.update(salesMailbox.id, {
      connectionStatus: 'CONNECTED',
      lastTestedAt: new Date(),
      lastTestedBy: admin.id,
      lastTestMessage: 'Conexión exitosa a IMAP y SMTP.',
    });

    // Assigns the demo executive as PRIMARY on the sales mailbox — this
    // is what lets the signature preview show real {sender.*} data
    // instead of the generic example (see SignaturesService.preview).
    await this.mailboxAssignments.upsert({
      organizationId: organization.id,
      mailboxId: salesMailbox.id,
      userId: executive.id,
      role: 'PRIMARY',
      assignedBy: admin.id,
    });

    // Demo-only client-hierarchy pivot data: one ManagedClient ("Empresa
    // Demostración (Demo)") with one Domain matching the demo mailboxes' own
    // email domain (mejoreferido-demo.test) — both demo mailboxes above get
    // linked to it, so the Clientes → Dominio → Cuenta navigation has
    // real data to click through instead of landing on an empty state.
    const demoClient = await this.managedClients.create({
      organizationId: organization.id,
      source: 'SERVER',
      serverClientId: 'srv_demo_9001',
      name: 'Empresa Demostración (Demo)',
      legalName: 'Empresa Demostración SpA (Demo)',
      industry: 'Tecnología',
      supervisorUserId: admin.id,
      createdBy: admin.id,
    });
    await this.clientAssignments.upsert({
      organizationId: organization.id,
      clientId: demoClient.id,
      userId: executive.id,
      role: 'PRIMARY',
      assignedBy: admin.id,
    });

    const demoDomain = await this.domains.create({
      organizationId: organization.id,
      clientId: demoClient.id,
      domainName: 'mejoreferido-demo.test',
      createdBy: admin.id,
    });
    await this.mailboxes.update(salesMailbox.id, {
      clientId: demoClient.id,
      domainId: demoDomain.id,
    });
    await this.mailboxes.update(inactiveMailbox.id, {
      clientId: demoClient.id,
      domainId: demoDomain.id,
    });

    // Demo-only templates: one active with variables (to show the {...}
    // chips derived by TemplatesService), one archived to exercise that
    // filter state too.
    await this.templates.create({
      organizationId: organization.id,
      name: 'Primer contacto (Demo)',
      subject: 'Hola {nombre}, una idea para {empresa}',
      body:
        'Hola {nombre},\n\nVi que {empresa} podría beneficiarse de automatizar su ' +
        'prospección por correo. ¿Tienes 15 minutos esta semana?\n\nSaludos.',
    });

    const archivedTemplate = await this.templates.create({
      organizationId: organization.id,
      name: 'Texto antiguo (Demo, archivado)',
      subject: 'Oferta especial',
      body: 'Este mensaje ya no se usa activamente, se mantiene solo como referencia.',
    });
    await this.templates.update(archivedTemplate.id, { status: 'ARCHIVED' });

    // Demo-only variable catalog: the entries a template editor would
    // offer as one-click inserts instead of the user typing {nombre} by
    // hand. One archived to exercise that filter state too.
    await this.variables.create({
      organizationId: organization.id,
      key: 'nombre',
      label: 'Nombre del contacto',
      description: 'Nombre de pila del destinatario del correo.',
      source: 'CONTACT',
    });
    await this.variables.create({
      organizationId: organization.id,
      key: 'empresa',
      label: 'Empresa del prospecto',
      description: 'Nombre de la empresa a la que pertenece el contacto.',
      source: 'CONTACT',
    });
    const archivedVariable = await this.variables.create({
      organizationId: organization.id,
      key: 'firma',
      label: 'Nombre del remitente (Demo, archivada)',
      description: 'Nombre del ejecutivo que envía el correo, tomado de la cuenta.',
      source: 'SENDER',
    });
    await this.variables.update(archivedVariable.id, { status: 'ARCHIVED' });

    // Demo-only signature on the sales mailbox: two versions, so the
    // history list and "activate an older version" action have something
    // real to show without needing to click through the flow first. The
    // second version uses the {sender.*} namespace to demonstrate real
    // executive-data resolution (see the PRIMARY assignment above).
    const salesSignature = await this.signatures.create({
      organizationId: organization.id,
      mailboxId: salesMailbox.id,
    });
    await this.signatureVersions.create({
      signatureId: salesSignature.id,
      htmlContent: '<p>Saludos,<br>{nombre}<br>Equipo de Ventas</p>',
      plainTextContent: 'Saludos,\n{nombre}\nEquipo de Ventas',
      createdBy: admin.id,
    });
    const secondSignatureVersion = await this.signatureVersions.create({
      signatureId: salesSignature.id,
      htmlContent:
        '<p>Atentamente,<br><strong>{sender.name}</strong><br>' +
        '{sender.company}<br>' +
        '<a href="mailto:{mailbox.email}">{mailbox.email}</a></p>',
      plainTextContent: 'Atentamente,\n{sender.name}\n{sender.company}\n{mailbox.email}',
      createdBy: admin.id,
    });
    await this.signatures.update(salesSignature.id, {
      activeVersionId: secondSignatureVersion.id,
    });

    // Demo-only sequence (Fase 10) on the demo executive, using the sales
    // mailbox as sender — its firma/assignment/connection state above are
    // exactly what SequencesService.getReadiness checks, so this sequence
    // shows a fully-passing "Cuenta" and "Steps" readiness out of the box.
    const demoSequence = await this.sequences.create({
      organizationId: organization.id,
      executiveId: executive.id,
      name: 'Prospección empresas de tecnología (Demo)',
      description: 'Secuencia de ejemplo para contactar empresas del sector tecnológico.',
      timezone: 'America/Santiago',
      createdBy: admin.id,
    });
    await this.sequences.update(demoSequence.id, {
      mailboxId: salesMailbox.id,
      // Stamped by hand here because this is a direct repository call,
      // bypassing SequencesService.update()'s automatic clientId deduction
      // (see Sequence.clientId's doc comment) — every real caller through
      // the service gets this for free.
      clientId: demoClient.id,
      updatedBy: admin.id,
    });

    const demoSteps = [
      {
        name: 'Primer contacto',
        subject: 'Una consulta para {contact.company}',
        htmlBody:
          '<p>Hola {contact.firstName},</p>' +
          '<p>Vi que {contact.company} podría beneficiarse de automatizar su prospección ' +
          'por correo. ¿Tienes 15 minutos esta semana?</p>',
        plainTextBody:
          'Hola {contact.firstName},\n\nVi que {contact.company} podría beneficiarse de ' +
          'automatizar su prospección por correo. ¿Tienes 15 minutos esta semana?',
        delayValue: 0,
        delayUnit: 'DAYS' as const,
        sendMode: 'NEW_THREAD' as const,
      },
      {
        name: 'Primer seguimiento',
        subject: '¿Pudiste revisar mi mensaje, {contact.firstName}?',
        htmlBody:
          '<p>Hola {contact.firstName},</p>' +
          '<p>Quería retomar contacto — ¿alcanzaste a ver mi mensaje anterior?</p>',
        plainTextBody:
          'Hola {contact.firstName},\n\nQuería retomar contacto — ¿alcanzaste a ver mi ' +
          'mensaje anterior?',
        delayValue: 2,
        delayUnit: 'DAYS' as const,
        sendMode: 'REPLY' as const,
      },
      {
        name: 'Último contacto',
        subject: 'Último contacto sobre {contact.company}',
        htmlBody:
          '<p>Hola {contact.firstName},</p>' +
          '<p>Este será mi último mensaje por ahora. Si más adelante te interesa retomar la ' +
          'conversación, aquí estaré.</p>',
        plainTextBody:
          'Hola {contact.firstName},\n\nEste será mi último mensaje por ahora. Si más ' +
          'adelante te interesa retomar la conversación, aquí estaré.',
        delayValue: 3,
        delayUnit: 'DAYS' as const,
        sendMode: 'REPLY' as const,
      },
    ];

    for (const [index, stepInput] of demoSteps.entries()) {
      const step = await this.sequenceSteps.create({
        organizationId: organization.id,
        sequenceId: demoSequence.id,
        position: index + 1,
        name: stepInput.name,
        subject: stepInput.subject,
        htmlBody: stepInput.htmlBody,
        plainTextBody: stepInput.plainTextBody,
        delayValue: stepInput.delayValue,
        delayUnit: stepInput.delayUnit,
        sendMode: stepInput.sendMode,
        createdBy: admin.id,
      });
      await this.sequenceStepVersions.create({
        sequenceStepId: step.id,
        subject: step.subject,
        preheader: step.preheader,
        htmlBody: step.htmlBody,
        plainTextBody: step.plainTextBody,
        delayValue: step.delayValue,
        delayUnit: step.delayUnit,
        sendMode: step.sendMode,
        createdBy: admin.id,
      });
    }

    // ------------------------------------------------------------------
    // Extended cascading-navigation demo data — a second and third
    // ManagedClient (one with two domains, one with a single empty
    // account) so the executive's "Cuentas de correos" tree has real
    // material to click through: clients with one vs. several domains,
    // domains with one vs. several accounts, accounts with zero/one/many
    // pending replies, already-read conversations, several contacts at
    // the same prospect company, and one worked example of each
    // response-outcome case (No interesado/No contactar/Interesado/
    // Deriva). Fictitious but internally coherent names/emails/domains.
    // ------------------------------------------------------------------

    const gtdClient = await this.managedClients.create({
      organizationId: organization.id,
      source: 'SERVER',
      serverClientId: 'srv_demo_9002',
      name: 'Demo Dos (Demo)',
      legalName: 'Demo Dos Chile S.A. (Demo)',
      industry: 'Telecomunicaciones',
      supervisorUserId: admin.id,
      createdBy: admin.id,
    });
    await this.clientAssignments.upsert({
      organizationId: organization.id,
      clientId: gtdClient.id,
      userId: executive.id,
      role: 'PRIMARY',
      assignedBy: admin.id,
    });

    const gtdClDomain = await this.domains.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      domainName: 'gtd.cl',
      createdBy: admin.id,
    });
    const circuloDomain = await this.domains.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      domainName: 'circulogtd.com',
      createdBy: admin.id,
    });

    const prospeccionMailbox = await this.createDemoMailbox({
      organizationId: organization.id,
      name: 'Prospección Demo Dos (Demo)',
      email: 'prospeccion@gtd.cl',
      fromName: 'Prospección Demo Dos',
      clientId: gtdClient.id,
      domainId: gtdClDomain.id,
      executiveId: executive.id,
      adminId: admin.id,
    });
    const comercialMailbox = await this.createDemoMailbox({
      organizationId: organization.id,
      name: 'Comercial Demo Dos (Demo)',
      email: 'comercial@gtd.cl',
      fromName: 'Equipo Comercial Demo Dos',
      clientId: gtdClient.id,
      domainId: gtdClDomain.id,
      executiveId: executive.id,
      adminId: admin.id,
    });
    const circuloMailbox = await this.createDemoMailbox({
      organizationId: organization.id,
      name: 'Contacto Círculo Demo Dos (Demo)',
      email: 'contacto@circulogtd.com',
      fromName: 'Círculo Demo Dos',
      clientId: gtdClient.id,
      domainId: circuloDomain.id,
      executiveId: executive.id,
      adminId: admin.id,
    });

    // Empresa Demostración Tres (Demo) — one domain, one account, deliberately
    // left with zero conversations ("cuenta sin respuestas").
    const andesClient = await this.managedClients.create({
      organizationId: organization.id,
      source: 'SERVER',
      serverClientId: 'srv_demo_9003',
      name: 'Empresa Demostración Tres (Demo)',
      legalName: 'Empresa Demostración Tres Ltda. (Demo)',
      industry: 'Construcción',
      supervisorUserId: admin.id,
      createdBy: admin.id,
    });
    await this.clientAssignments.upsert({
      organizationId: organization.id,
      clientId: andesClient.id,
      userId: executive.id,
      role: 'PRIMARY',
      assignedBy: admin.id,
    });
    const andesDomain = await this.domains.create({
      organizationId: organization.id,
      clientId: andesClient.id,
      domainName: 'andes-demo.cl',
      createdBy: admin.id,
    });
    await this.createDemoMailbox({
      organizationId: organization.id,
      name: 'Ventas Empresa Demostración Tres (Demo)',
      email: 'ventas@andes-demo.cl',
      fromName: 'Ventas Empresa Demostración Tres',
      clientId: andesClient.id,
      domainId: andesDomain.id,
      executiveId: executive.id,
      adminId: admin.id,
    });

    // --- prospección@gtd.cl: "varias conversaciones pendientes" + un contacto ya leído + 2 contactos de una misma empresa ---
    const prospeccionSequence = await this.createDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: prospeccionMailbox.id,
      name: 'Prospección tecnología Demo Dos (Demo)',
      adminId: admin.id,
    });
    const minera = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Empresa Contacto Demo Tres SPA',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: gtdClDomain.id,
      mailbox: prospeccionMailbox,
      executiveId: executive.id,
      sequence: prospeccionSequence.sequence,
      step: prospeccionSequence.steps[0],
      company: minera,
      contactEmail: 'juan.soto@mineralosandes-demo.cl',
      contactFirstName: 'Juan',
      contactLastName: 'Soto',
      subject: 'Consulta sobre integración con nuestro CRM',
      replyText: 'Hola, nos interesa saber más — ¿pueden enviarnos más detalles?',
      isUnread: true,
      hoursAgo: 3,
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: gtdClDomain.id,
      mailbox: prospeccionMailbox,
      executiveId: executive.id,
      sequence: prospeccionSequence.sequence,
      step: prospeccionSequence.steps[0],
      company: minera,
      contactEmail: 'maria.soto@mineralosandes-demo.cl',
      contactFirstName: 'María',
      contactLastName: 'Soto',
      subject: 'Re: Una consulta para Empresa Contacto Demo Tres SPA',
      replyText: 'Gracias por el mensaje, ya lo revisamos internamente.',
      isUnread: false,
      hoursAgo: 30,
    });
    const retailSur = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Retail Sur Ltda.',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: gtdClDomain.id,
      mailbox: prospeccionMailbox,
      executiveId: executive.id,
      sequence: prospeccionSequence.sequence,
      step: prospeccionSequence.steps[0],
      company: retailSur,
      contactEmail: 'ana.rivas@retailsur-demo.cl',
      contactFirstName: 'Ana',
      contactLastName: 'Rivas',
      subject: 'Consulta por automatización de prospección',
      replyText: '¿Tienen disponibilidad esta semana para una llamada breve?',
      isUnread: true,
      hoursAgo: 5,
    });

    // --- comercial@gtd.cl: exactamente una respuesta pendiente ---
    const comercialSequence = await this.createDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: comercialMailbox.id,
      name: 'Prospección comercial Demo Dos (Demo)',
      adminId: admin.id,
    });
    const bioSur = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Consultora Bio Sur',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: gtdClDomain.id,
      mailbox: comercialMailbox,
      executiveId: executive.id,
      sequence: comercialSequence.sequence,
      step: comercialSequence.steps[0],
      company: bioSur,
      contactEmail: 'tomas.leon@biosur-demo.cl',
      contactFirstName: 'Tomás',
      contactLastName: 'León',
      subject: 'Consulta sobre el servicio ofrecido',
      replyText: '¿Podrían contarme un poco más sobre los planes disponibles?',
      isUnread: true,
      hoursAgo: 8,
    });

    // --- contacto@circulogtd.com: un ejemplo de cada resultado de respuesta, todos ya gestionados/leídos ---
    const circuloSequence = await this.createDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: circuloMailbox.id,
      name: 'Gestión círculo Demo Dos (Demo)',
      adminId: admin.id,
    });

    // Interesado — toda la empresa se detiene, la gestión sigue por fuera de la secuencia.
    const consultoraNorte = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Consultora Norte SpA',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: circuloDomain.id,
      mailbox: circuloMailbox,
      executiveId: executive.id,
      sequence: circuloSequence.sequence,
      step: circuloSequence.steps[0],
      company: consultoraNorte,
      contactEmail: 'patricia.mena@consultoranorte-demo.cl',
      contactFirstName: 'Patricia',
      contactLastName: 'Mena',
      subject: 'Nos interesa avanzar',
      replyText: 'Nos interesa avanzar con esto, ¿podemos coordinar una reunión comercial?',
      isUnread: false,
      hoursAgo: 48,
      sequenceContactStatus: 'COMPLETED_MANUALLY',
      responseOutcome: 'INTERESTED',
      stopReason: 'La empresa mostró interés — la gestión continúa fuera de la secuencia.',
    });

    // No interesado — dos contactos de la misma empresa, ambos detenidos.
    const ferreteria = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Ferretería El Roble',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: circuloDomain.id,
      mailbox: circuloMailbox,
      executiveId: executive.id,
      sequence: circuloSequence.sequence,
      step: circuloSequence.steps[0],
      company: ferreteria,
      contactEmail: 'marcos.pena@ferreteriaelroble-demo.cl',
      contactFirstName: 'Marcos',
      contactLastName: 'Peña',
      subject: 'No nos interesa por ahora',
      replyText: 'Por ahora no estamos interesados, gracias de todas formas.',
      isUnread: false,
      hoursAgo: 60,
      sequenceContactStatus: 'COMPLETED_MANUALLY',
      responseOutcome: 'NOT_INTERESTED',
      stopReason: 'La empresa indicó que no está interesada.',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: circuloDomain.id,
      mailbox: circuloMailbox,
      executiveId: executive.id,
      sequence: circuloSequence.sequence,
      step: circuloSequence.steps[0],
      company: ferreteria,
      contactEmail: 'elena.paredes@ferreteriaelroble-demo.cl',
      contactFirstName: 'Elena',
      contactLastName: 'Paredes',
      subject: 'Re: Una consulta para Ferretería El Roble',
      replyText: 'Coincido con lo que te comentó mi colega Marcos.',
      isUnread: false,
      hoursAgo: 60,
      sequenceContactStatus: 'COMPLETED_MANUALLY',
      responseOutcome: 'NOT_INTERESTED',
      stopReason: 'La empresa indicó que no está interesada.',
    });

    // No contactar — exclusión global solo de esta dirección.
    const panaderia = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Panadería Dulce Hogar',
    });
    const rosaThread = await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: circuloDomain.id,
      mailbox: circuloMailbox,
      executiveId: executive.id,
      sequence: circuloSequence.sequence,
      step: circuloSequence.steps[0],
      company: panaderia,
      contactEmail: 'rosa.nunez@panaderiadulcehogar-demo.cl',
      contactFirstName: 'Rosa',
      contactLastName: 'Nuñez',
      subject: 'Solicito no recibir más correos',
      replyText: 'Por favor no me envíen más correos de este tipo.',
      isUnread: false,
      hoursAgo: 72,
      sequenceContactStatus: 'REMOVED',
      responseOutcome: 'DO_NOT_CONTACT',
      stopReason: 'No contactar: solicitó no recibir más correos.',
    });
    await this.contacts.update(rosaThread.contact.id, {
      suppressed: true,
      suppressedAt: new Date(),
      suppressedReason: 'Solicitó no recibir más correos.',
    });

    // Deriva — se retira al contacto original y se matricula al nuevo dentro de la misma empresa.
    const transportes = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Transportes Bío Bío',
    });
    await this.seedProspectThread({
      organizationId: organization.id,
      adminId: admin.id,
      clientId: gtdClient.id,
      domainId: circuloDomain.id,
      mailbox: circuloMailbox,
      executiveId: executive.id,
      sequence: circuloSequence.sequence,
      step: circuloSequence.steps[0],
      company: transportes,
      contactEmail: 'luis.carcamo@transportesbiobio-demo.cl',
      contactFirstName: 'Luis',
      contactLastName: 'Cárcamo',
      subject: 'Deriva a otro contacto',
      replyText: 'Yo ya no veo estos temas — te dejo con Marta, que ahora lleva esto.',
      isUnread: false,
      hoursAgo: 80,
      sequenceContactStatus: 'REMOVED',
      responseOutcome: 'REFERRED',
      stopReason: 'Derivó a marta.carcamo@transportesbiobio-demo.cl',
    });
    const martaContact = await this.contacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      companyId: transportes.id,
      email: 'marta.carcamo@transportesbiobio-demo.cl',
      firstName: 'Marta',
      lastName: 'Cárcamo',
    });
    await this.sequenceContacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      sequenceId: circuloSequence.sequence.id,
      sequenceVersion: circuloSequence.sequence.sequenceVersion,
      contactId: martaContact.id,
      companyId: transportes.id,
      assignedMailboxId: circuloMailbox.id,
      assignedExecutiveId: executive.id,
      currentStepId: circuloSequence.steps[0].id,
      currentStepPosition: circuloSequence.steps[0].position,
    });

    // --- New "Secuencias" module demo data: wizard-shaped (FIXED_3) sequences covering every state the ---
    // --- Borradores/Programadas/En ejecución/Historial tabs need to show something real. ---
    const nowMs = Date.now();

    // Borrador — created via the wizard, never published.
    await this.createWizardDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: prospeccionMailbox.id,
      managementDate: '2026-07-25',
      adminId: admin.id,
    });

    // Programada — publicada, con fecha de gestión e inicio efectivo en el futuro.
    await this.createWizardDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: comercialMailbox.id,
      managementDate: '2026-07-27',
      adminId: admin.id,
      overrides: {
        publishStatus: 'ACTIVE',
        sequenceVersion: 1,
        lastPublishedAt: new Date(nowMs),
        effectiveStartAt: new Date('2026-07-27T12:00:00.000Z'),
      },
    });

    // En ejecución — publicada, inicio efectivo ya pasado, con una empresa de 2 contactos avanzando por los steps.
    const activaSequence = await this.createWizardDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: prospeccionMailbox.id,
      managementDate: '2026-07-20',
      adminId: admin.id,
      overrides: {
        publishStatus: 'ACTIVE',
        sequenceVersion: 1,
        lastPublishedAt: new Date(nowMs - 2 * HOUR_MS),
        effectiveStartAt: new Date(nowMs - 2 * HOUR_MS),
      },
    });
    const vertexSur = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Empresa Contacto Demo Cuatro',
    });
    const vertexContact1 = await this.contacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      companyId: vertexSur.id,
      email: 'pablo.reyes@vertexsur-demo.cl',
      firstName: 'Pablo',
      lastName: 'Reyes',
    });
    const vertexContact2 = await this.contacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      companyId: vertexSur.id,
      email: 'carla.munoz@vertexsur-demo.cl',
      firstName: 'Carla',
      lastName: 'Muñoz',
    });
    await this.sequenceContacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      sequenceId: activaSequence.sequence.id,
      sequenceVersion: activaSequence.sequence.sequenceVersion,
      contactId: vertexContact1.id,
      companyId: vertexSur.id,
      assignedMailboxId: prospeccionMailbox.id,
      assignedExecutiveId: executive.id,
      currentStepId: activaSequence.steps[1].id,
      currentStepPosition: activaSequence.steps[1].position,
    });
    await this.sequenceContacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      sequenceId: activaSequence.sequence.id,
      sequenceVersion: activaSequence.sequence.sequenceVersion,
      contactId: vertexContact2.id,
      companyId: vertexSur.id,
      assignedMailboxId: prospeccionMailbox.id,
      assignedExecutiveId: executive.id,
      currentStepId: activaSequence.steps[0].id,
      currentStepPosition: activaSequence.steps[0].position,
    });

    // Completada — todos los contactos terminaron los 3 steps.
    const completadaSequence = await this.createWizardDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: comercialMailbox.id,
      managementDate: '2026-06-15',
      adminId: admin.id,
      overrides: {
        publishStatus: 'COMPLETED',
        sequenceVersion: 1,
        lastPublishedAt: new Date('2026-06-15T12:00:00.000Z'),
        effectiveStartAt: new Date('2026-06-15T12:00:00.000Z'),
      },
    });
    const distribuidoraCentro = await this.companies.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      rawName: 'Distribuidora Centro',
    });
    const distribuidoraContact = await this.contacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      companyId: distribuidoraCentro.id,
      email: 'ignacio.silva@distribuidoracentro-demo.cl',
      firstName: 'Ignacio',
      lastName: 'Silva',
    });
    await this.sequenceContacts.create({
      organizationId: organization.id,
      clientId: gtdClient.id,
      sequenceId: completadaSequence.sequence.id,
      sequenceVersion: completadaSequence.sequence.sequenceVersion,
      contactId: distribuidoraContact.id,
      companyId: distribuidoraCentro.id,
      assignedMailboxId: comercialMailbox.id,
      assignedExecutiveId: executive.id,
      currentStepId: completadaSequence.steps[2].id,
      currentStepPosition: completadaSequence.steps[2].position,
    });

    // Con errores — el motor simulado reportó un fallo al publicar; el borrador se conserva intacto.
    await this.createWizardDemoSequence({
      organizationId: organization.id,
      executiveId: executive.id,
      clientId: gtdClient.id,
      mailboxId: circuloMailbox.id,
      managementDate: '2026-07-18',
      adminId: admin.id,
      overrides: { publishStatus: 'FAILED' },
    });

    // Never log password values — only confirms the seed ran and who it created.
    this.logger.log(
      `Dev seed loaded (memory mode): organization "${organization.name}", ` +
        `admin <${admin.email}>, executive <${executive.email}>, ` +
        `plus 2 demo-only executives (1 active, 1 inactive), 6 demo-only ` +
        `mailboxes across 3 clients (Empresa Demostración, Demo Dos, Empresa Demostración Tres — ` +
        `varying domain/account counts, unread states, and one worked ` +
        `example each of No interesado/No contactar/Interesado/Deriva), ` +
        `2 demo-only templates (1 active, 1 archived), 3 demo-only variables ` +
        `(2 active, 1 archived), 1 demo-only signature (2 versions), ` +
        `4 demo-only sequences for UI review, and 5 wizard-shaped demo ` +
        `sequences for the new Secuencias module (borrador, programada, ` +
        `en ejecución, completada, con errores).`,
    );
  }

  /**
   * Shared boilerplate for every demo-only mailbox: fake, non-routable-looking
   * hosts so nobody mistakes them for a real account, linked to its
   * client/domain, and assigned PRIMARY to the demo executive.
   *
   * `MockEngineClient` fabricates the SAME fixed pool of canned demo
   * threads (Camila Torres, Diego Fuentes, etc.) for ANY mailbox whose
   * inbox gets synced, regardless of which one it is — harmless for the
   * original Empresa Demostración mailboxes (that's their whole point), but it would
   * silently add 2 extra "unread" conversations on top of whatever this
   * seed deliberately places in these NEW mailboxes, breaking the precise
   * unread-count scenarios ("cuenta sin respuestas", "una respuesta
   * pendiente") the interface review asked for. `setScenario(email,
   * 'CREDENTIALS_ERROR')` makes `fetchInbox` return zero threads for these
   * specific mailboxes, so their counts come ONLY from the Conversation
   * rows this seed creates directly.
   */
  private async createDemoMailbox(params: {
    organizationId: string;
    name: string;
    email: string;
    fromName: string;
    clientId: string;
    domainId: string;
    executiveId: string;
    adminId: string;
  }): Promise<Mailbox> {
    this.mockEngine.setScenario(params.email, 'CREDENTIALS_ERROR');
    const mailbox = await this.mailboxes.create({
      organizationId: params.organizationId,
      name: params.name,
      email: params.email,
      fromName: params.fromName,
      replyTo: null,
      imap: {
        host: `imap.demo.${params.email.split('@')[1]}`,
        port: 993,
        encryption: 'SSL_TLS',
        username: params.email,
        verifyCertificate: true,
        secretCiphertext: this.secrets.encrypt(randomUUID()),
      },
      smtp: {
        host: `smtp.demo.${params.email.split('@')[1]}`,
        port: 587,
        encryption: 'STARTTLS',
        username: params.email,
        verifyCertificate: true,
        secretCiphertext: this.secrets.encrypt(randomUUID()),
      },
    });
    await this.mailboxes.update(mailbox.id, {
      clientId: params.clientId,
      domainId: params.domainId,
      connectionStatus: 'CONNECTED',
      lastTestedAt: new Date(),
      lastTestedBy: params.adminId,
      lastTestMessage: 'Conexión exitosa a IMAP y SMTP.',
    });
    await this.mailboxAssignments.upsert({
      organizationId: params.organizationId,
      mailboxId: mailbox.id,
      userId: params.executiveId,
      role: 'PRIMARY',
      assignedBy: params.adminId,
    });
    return mailbox;
  }

  /** A 2-published-step sequence attached to one mailbox — the minimum needed for realistic Secuencia/Step traceability on seeded conversations. */
  private async createDemoSequence(params: {
    organizationId: string;
    executiveId: string;
    clientId: string;
    mailboxId: string;
    name: string;
    adminId: string;
  }): Promise<{ sequence: Sequence; steps: [import('../../domain/sequence/sequence-step.entity').SequenceStep, import('../../domain/sequence/sequence-step.entity').SequenceStep] }> {
    const sequence = await this.sequences.create({
      organizationId: params.organizationId,
      executiveId: params.executiveId,
      name: params.name,
      description: null,
      timezone: 'America/Santiago',
      createdBy: params.adminId,
    });
    await this.sequences.update(sequence.id, {
      mailboxId: params.mailboxId,
      clientId: params.clientId,
      updatedBy: params.adminId,
    });

    const step1 = await this.sequenceSteps.create({
      organizationId: params.organizationId,
      sequenceId: sequence.id,
      position: 1,
      name: 'Primer contacto',
      subject: 'Una consulta para {contact.company}',
      htmlBody: '<p>Hola {contact.firstName},</p><p>¿Tienes unos minutos esta semana?</p>',
      plainTextBody: 'Hola {contact.firstName},\n\n¿Tienes unos minutos esta semana?',
      delayValue: 0,
      delayUnit: 'DAYS',
      sendMode: 'NEW_THREAD',
      createdBy: params.adminId,
    });
    await this.sequenceSteps.update(step1.id, { status: 'PUBLISHED', updatedBy: params.adminId });
    await this.sequenceStepVersions.create({
      sequenceStepId: step1.id,
      subject: step1.subject,
      preheader: step1.preheader,
      htmlBody: step1.htmlBody,
      plainTextBody: step1.plainTextBody,
      delayValue: step1.delayValue,
      delayUnit: step1.delayUnit,
      sendMode: step1.sendMode,
      createdBy: params.adminId,
    });

    const step2 = await this.sequenceSteps.create({
      organizationId: params.organizationId,
      sequenceId: sequence.id,
      position: 2,
      name: 'Seguimiento',
      subject: '¿Pudiste revisar mi mensaje, {contact.firstName}?',
      htmlBody: '<p>Hola {contact.firstName},</p><p>Quería retomar contacto.</p>',
      plainTextBody: 'Hola {contact.firstName},\n\nQuería retomar contacto.',
      delayValue: 2,
      delayUnit: 'DAYS',
      sendMode: 'REPLY',
      createdBy: params.adminId,
    });
    await this.sequenceSteps.update(step2.id, { status: 'PUBLISHED', updatedBy: params.adminId });
    await this.sequenceStepVersions.create({
      sequenceStepId: step2.id,
      subject: step2.subject,
      preheader: step2.preheader,
      htmlBody: step2.htmlBody,
      plainTextBody: step2.plainTextBody,
      delayValue: step2.delayValue,
      delayUnit: step2.delayUnit,
      sendMode: step2.sendMode,
      createdBy: params.adminId,
    });

    const updatedSequence = (await this.sequences.findById(sequence.id)) ?? sequence;
    return { sequence: updatedSequence, steps: [step1, step2] };
  }

  /**
   * A wizard-shaped sequence (FIXED_3, Enviados_1/2/3, auto-generated
   * `Gestión_DDMMYYYY` name) for demonstrating the new Secuencias module's
   * borrador/programada/en-ejecución/completada/con-errores states in the
   * demo — `overrides` lets the seed set `publishStatus`/`sequenceVersion`/
   * `lastPublishedAt`/`effectiveStartAt` directly (bypassing a real
   * publish + simulated-engine round trip, exactly like the rest of this
   * file already does for step/contact statuses elsewhere).
   */
  private async createWizardDemoSequence(params: {
    organizationId: string;
    executiveId: string;
    clientId: string;
    mailboxId: string;
    managementDate: string;
    adminId: string;
    overrides?: {
      publishStatus?: SequencePublishStatus | null;
      sequenceVersion?: number;
      lastPublishedAt?: Date | null;
      effectiveStartAt?: Date | null;
    };
  }): Promise<{ sequence: Sequence; steps: SequenceStep[] }> {
    const sequence = await this.sequences.create({
      organizationId: params.organizationId,
      executiveId: params.executiveId,
      name: generateSequenceName(params.managementDate),
      timezone: 'America/Santiago',
      createdBy: params.adminId,
      managementDate: params.managementDate,
      stepPolicy: 'FIXED_3',
      schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], windows: [{ start: '08:00', end: '19:00' }] },
    });
    await this.sequences.update(sequence.id, {
      mailboxId: params.mailboxId,
      clientId: params.clientId,
      updatedBy: params.adminId,
      ...params.overrides,
    });

    const specs: Array<{
      name: string;
      delayValue: number;
      delayUnit: 'DAYS' | 'BUSINESS_DAYS';
      sendMode: 'NEW_THREAD' | 'REPLY';
      htmlBody: string;
    }> = [
      {
        name: 'Enviados_1',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
        htmlBody:
          '<p>Hola {nombre_contacto},</p><p>Vi que {empresa} podría beneficiarse de automatizar su ' +
          'prospección por correo. ¿Tienes 15 minutos esta semana?</p>',
      },
      {
        name: 'Enviados_2',
        delayValue: 5,
        delayUnit: 'BUSINESS_DAYS',
        sendMode: 'REPLY',
        htmlBody:
          '<p>Hola {nombre_contacto},</p><p>Quería retomar contacto — dado el rubro de {empresa} ' +
          '({rubro}), creo que podemos ayudarles concretamente.</p>',
      },
      {
        name: 'Enviados_3',
        delayValue: 10,
        delayUnit: 'BUSINESS_DAYS',
        sendMode: 'REPLY',
        htmlBody: '<p>Hola {nombre_contacto},</p><p>Último seguimiento antes de cerrar el contacto por ahora.</p>',
      },
    ];

    const steps: SequenceStep[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const subject = '{nombre_contacto}, una idea para {empresa}';
      const plainTextBody = spec.htmlBody.replace(/<[^>]+>/g, '');
      const step = await this.sequenceSteps.create({
        organizationId: params.organizationId,
        sequenceId: sequence.id,
        position: index + 1,
        name: spec.name,
        subject,
        htmlBody: spec.htmlBody,
        plainTextBody,
        delayValue: spec.delayValue,
        delayUnit: spec.delayUnit,
        sendMode: spec.sendMode,
        createdBy: params.adminId,
      });
      if (index === 0) {
        await this.sequenceSteps.update(step.id, { status: 'PUBLISHED', updatedBy: params.adminId });
      }
      await this.sequenceStepVersions.create({
        sequenceStepId: step.id,
        subject: step.subject,
        preheader: null,
        htmlBody: step.htmlBody,
        plainTextBody: step.plainTextBody,
        delayValue: step.delayValue,
        delayUnit: step.delayUnit,
        sendMode: step.sendMode,
        createdBy: params.adminId,
      });
      steps.push(step);
    }

    const updatedSequence = (await this.sequences.findById(sequence.id)) ?? sequence;
    return { sequence: updatedSequence, steps };
  }

  /**
   * One prospect's full thread: Contact + SequenceContact (enrolled at the
   * given step) + a SENT ScheduledEmail for that step (for Secuencia/Step
   * traceability) + a Conversation with one outbound and one inbound
   * message, mirroring exactly what `ReplySimulationService` produces so
   * the seeded data is indistinguishable from a "real" simulated reply.
   */
  private async seedProspectThread(params: {
    organizationId: string;
    adminId: string;
    clientId: string;
    domainId: string;
    mailbox: Mailbox;
    executiveId: string;
    sequence: Sequence;
    step: import('../../domain/sequence/sequence-step.entity').SequenceStep;
    company: { id: string };
    contactEmail: string;
    contactFirstName: string;
    contactLastName: string;
    subject: string;
    replyText: string;
    isUnread: boolean;
    hoursAgo: number;
    sequenceContactStatus?: SequenceContactStatus;
    responseOutcome?: ResponseOutcome;
    stopReason?: string;
  }): Promise<{ contact: import('../../domain/contact/contact.entity').Contact; sequenceContact: SequenceContact }> {
    const contact = await this.contacts.create({
      organizationId: params.organizationId,
      clientId: params.clientId,
      companyId: params.company.id,
      email: params.contactEmail,
      firstName: params.contactFirstName,
      lastName: params.contactLastName,
    });

    let sequenceContact = await this.sequenceContacts.create({
      organizationId: params.organizationId,
      clientId: params.clientId,
      sequenceId: params.sequence.id,
      sequenceVersion: params.sequence.sequenceVersion,
      contactId: contact.id,
      companyId: params.company.id,
      assignedMailboxId: params.mailbox.id,
      assignedExecutiveId: params.executiveId,
      currentStepId: params.step.id,
      currentStepPosition: params.step.position,
    });

    const sentAt = new Date(Date.now() - (params.hoursAgo + 1) * HOUR_MS);
    const scheduledEmail = await this.scheduledEmails.create({
      organizationId: params.organizationId,
      sequenceId: params.sequence.id,
      sequenceVersion: params.sequence.sequenceVersion,
      sequenceContactId: sequenceContact.id,
      contactId: contact.id,
      companyId: params.company.id,
      sequenceStepId: params.step.id,
      stepVersion: 1,
      mailboxId: params.mailbox.id,
      batchId: `demo_${randomUUID()}`,
      scheduledAt: sentAt,
      priority: 'NEW_CONTACT',
      idempotencyKey: `demo:${sequenceContact.id}:${params.step.id}:1`,
    });
    await this.scheduledEmails.update(scheduledEmail.id, {
      status: 'SENT',
      sentAt,
      subjectSnapshot: params.step.subject,
      htmlBodySnapshot: params.step.htmlBody,
      plainTextBodySnapshot: params.step.plainTextBody,
      messageIdHeader: `<outbound_${scheduledEmail.id.slice(0, 8)}@mailengine.mroutreach.local>`,
    });

    const lastMessageAt = new Date(Date.now() - params.hoursAgo * HOUR_MS);
    const conversation = await this.conversations.create({
      organizationId: params.organizationId,
      clientId: params.clientId,
      domainId: params.domainId,
      mailboxId: params.mailbox.id,
      emailThreadId: `sim-thread-${sequenceContact.id}`,
      contactEmail: contact.email,
      contactName: `${contact.firstName} ${contact.lastName}`,
      contactId: contact.id,
      companyId: params.company.id,
      origin: 'LEGACY_SEQUENCE',
      sequenceContactId: sequenceContact.id,
      originatingScheduledEmailId: scheduledEmail.id,
      sequenceId: params.sequence.id,
      sequenceStepId: params.step.id,
      assignedExecutiveId: params.executiveId,
      subject: params.subject,
      isUnread: params.isUnread,
      lastMessageAt,
    });

    await this.conversationMessages.create({
      organizationId: params.organizationId,
      conversationId: conversation.id,
      mailboxId: params.mailbox.id,
      emailMessageId: `demo-out-${scheduledEmail.id}`,
      direction: 'OUTBOUND',
      senderEmail: params.mailbox.email,
      senderName: params.mailbox.fromName,
      recipients: [contact.email],
      subject: params.step.subject,
      htmlBody: params.step.htmlBody,
      plainTextBody: params.step.plainTextBody,
      sentAt,
      messageType: 'OUTREACH_EMAIL',
    });
    await this.conversationMessages.create({
      organizationId: params.organizationId,
      conversationId: conversation.id,
      mailboxId: params.mailbox.id,
      emailMessageId: `demo-in-${conversation.id}`,
      direction: 'INBOUND',
      senderEmail: contact.email,
      senderName: `${contact.firstName} ${contact.lastName}`,
      recipients: [params.mailbox.email],
      subject: params.subject,
      htmlBody: `<p>${params.replyText}</p>`,
      plainTextBody: params.replyText,
      receivedAt: lastMessageAt,
      messageType: 'HUMAN_REPLY',
    });

    if (params.responseOutcome) {
      await this.conversations.update(conversation.id, { responseOutcome: params.responseOutcome });
    }
    if (params.sequenceContactStatus && params.sequenceContactStatus !== 'ACTIVE') {
      sequenceContact = await this.sequenceContacts.update(sequenceContact.id, {
        status: params.sequenceContactStatus,
        stoppedAt: new Date(),
        stopReason: params.stopReason ?? null,
        ...(params.sequenceContactStatus === 'COMPLETED_MANUALLY' ? { completedAt: new Date() } : {}),
      });
    }

    return { contact, sequenceContact };
  }
}
