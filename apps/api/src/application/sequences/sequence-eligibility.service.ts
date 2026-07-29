import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { Domain } from '../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';

export interface SequenceEligibilityInput {
  organizationId: string;
  clientId: string;
  executiveId: string;
  domainId?: string | null;
  mailboxId?: string | null;
}

export interface SequenceEligibilityResult {
  crmClient: CrmClient;
  managedClient: ManagedClient;
  executive: User;
  domain: Domain | null;
  mailbox: Mailbox | null;
  /** Whether `executiveId` is already an assignee of `mailbox` (false when mailboxId wasn't given). */
  mailboxAlreadyAssigned: boolean;
}

/**
 * Fase 2, Caso C — the single, centralized source of truth for "may this
 * client/domain/account/executive combination create or publish new
 * sequence activity", replacing three previously ad hoc implementations
 * (SequencesService's admin-wizard path, its executive-wizard path, and
 * SequencePublishService's own partial checks). Administrador and
 * ejecutivo use exactly the same rules here — callers differentiate only
 * by which permissions/scope they additionally enforce before calling in.
 *
 * Pure validation: never writes to PostgreSQL, never creates a command,
 * never opens a transaction, never records audit. The CRM check
 * (`CrmClientEligibilityService.getVerifiedActiveClient`) is itself a pure
 * read — safe to call before opening any local transaction.
 */
@Injectable()
export class SequenceEligibilityService {
  constructor(
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly clientAssignments: ClientExecutiveAssignmentRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly crmEligibility: CrmClientEligibilityService,
  ) {}

  async verify(input: SequenceEligibilityInput): Promise<SequenceEligibilityResult> {
    const executive = await this.users.findById(input.executiveId);
    if (!executive || executive.organizationId !== input.organizationId) {
      throw new NotFoundException('Executive not found.');
    }
    if (executive.status !== 'ACTIVE') {
      throw new BadRequestException('Executive is not active.');
    }

    const managedClient = await this.managedClients.findById(input.clientId);
    if (!managedClient || managedClient.organizationId !== input.organizationId) {
      throw new BadRequestException('Invalid client id.');
    }
    if (managedClient.status !== 'ACTIVE') {
      throw new BadRequestException('El cliente seleccionado no está activo.');
    }

    // Fase 2.1 — a SERVER-origin client with no CRM linkage can't create
    // sequences yet: out of scope for this phase (§20), never fabricated.
    if (managedClient.crmClientId === null) {
      throw new BadRequestException('Este cliente no tiene vinculación con el CRM; no admite secuencias todavía.');
    }
    // Live CRM check — never writes, never inside a transaction. Throws
    // 404/409/503 exactly as CrmClientEligibilityService already defines.
    const crmClient = await this.crmEligibility.getVerifiedActiveClient(managedClient.crmClientId);

    const clientAssignments = await this.clientAssignments.findByUser(input.executiveId);
    if (!clientAssignments.some((assignment) => assignment.clientId === managedClient.id)) {
      throw new BadRequestException('El ejecutivo no está asignado a este cliente.');
    }

    let domain: Domain | null = null;
    if (input.domainId) {
      domain = await this.domains.findById(input.domainId);
      if (!domain || domain.organizationId !== input.organizationId) {
        throw new BadRequestException('Invalid domain id.');
      }
      if (domain.clientId !== managedClient.id) {
        throw new BadRequestException('El dominio seleccionado no pertenece al cliente indicado.');
      }
      if (domain.status !== 'ACTIVE') {
        throw new BadRequestException('El dominio seleccionado no está activo.');
      }
    }

    let mailbox: Mailbox | null = null;
    let mailboxAlreadyAssigned = false;
    if (input.mailboxId) {
      mailbox = await this.mailboxes.findById(input.mailboxId);
      if (!mailbox || mailbox.organizationId !== input.organizationId) {
        throw new BadRequestException('Invalid mailbox id.');
      }
      if (domain && mailbox.domainId !== domain.id) {
        throw new BadRequestException('La cuenta de correo seleccionada no pertenece al dominio indicado.');
      }
      if (mailbox.clientId !== managedClient.id) {
        throw new BadRequestException('La cuenta de correo seleccionada no pertenece al cliente indicado.');
      }
      // Fase 2.1 — a SERVER_TOKEN mailbox never populates
      // connectionStatus/provisioningStatus (those describe the
      // LEGACY_LOCAL credential flow); its own local-status/linkStatus
      // check here is a fast, cheap gate for wizard selection only — the
      // authoritative, live motor check happens right before publish (see
      // PublishSequenceUseCase.assertServerMailboxEligible), never here.
      if (mailbox.linkSource === 'SERVER_TOKEN') {
        if (mailbox.status !== 'ACTIVE' || mailbox.linkStatus !== 'ACTIVE') {
          throw new ConflictException('La cuenta de correo seleccionada no está activa o fue desvinculada.');
        }
      } else if (
        mailbox.status !== 'ACTIVE' ||
        mailbox.connectionStatus !== 'CONNECTED' ||
        mailbox.provisioningStatus !== 'PROVISIONED'
      ) {
        throw new ConflictException('La cuenta de correo seleccionada no está vinculada o tiene errores de conexión.');
      }
      const assignments = await this.mailboxAssignments.findByMailbox(mailbox.id);
      mailboxAlreadyAssigned = assignments.some((assignment) => assignment.userId === input.executiveId);
    }

    return { crmClient, managedClient, executive, domain, mailbox, mailboxAlreadyAssigned };
  }
}
