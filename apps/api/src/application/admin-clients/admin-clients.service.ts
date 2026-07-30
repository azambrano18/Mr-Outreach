import { Inject, Injectable } from '@nestjs/common';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { Domain } from '../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import {
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { AdminClientOverview, AdminClientsListResult, ClientConfigurationStatus } from './admin-clients.types';

const INCIDENT_CONNECTION_STATUSES = new Set(['CONNECTION_ERROR', 'ENGINE_UNAVAILABLE']);

/** Pure local listado de ManagedClient con su estado de configuración — ya no cruza ningún catálogo externo. */
@Injectable()
export class AdminClientsService {
  constructor(
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly assignments: ClientExecutiveAssignmentRepository,
  ) {}

  async list(organizationId: string, search?: string): Promise<AdminClientsListResult> {
    const [localClients, allDomains, allMailboxes] = await Promise.all([
      this.managedClients.findAll(organizationId),
      this.domains.findAll(organizationId),
      this.mailboxes.findAll(organizationId),
    ]);

    const term = search?.trim().toLowerCase();
    const filtered = term
      ? localClients.filter((c) => c.name.toLowerCase().includes(term) || c.internalCode?.toLowerCase().includes(term))
      : localClients;

    const clients = await Promise.all(
      filtered.map((client) => this.buildOverview(client, allDomains, allMailboxes)),
    );

    return { available: true, clients };
  }

  private async buildOverview(
    client: ManagedClient,
    allDomains: Domain[],
    allMailboxes: Mailbox[],
  ): Promise<AdminClientOverview> {
    const clientDomains = allDomains.filter((d) => d.clientId === client.id);
    const clientMailboxes = allMailboxes.filter((m) => m.clientId === client.id);
    const clientAssignments = await this.assignments.findByClient(client.id);

    const hasIncident = clientMailboxes.some(
      (m) => INCIDENT_CONNECTION_STATUSES.has(m.connectionStatus) || m.provisioningStatus === 'PROVISION_FAILED',
    );

    let configurationStatus: ClientConfigurationStatus;
    if (hasIncident) {
      configurationStatus = 'CON_INCIDENCIAS';
    } else if (clientDomains.length === 0 || clientMailboxes.length === 0 || clientAssignments.length === 0) {
      configurationStatus = 'CONFIGURACION_INCOMPLETA';
    } else {
      configurationStatus = 'CONFIGURADO';
    }

    return {
      id: client.id,
      name: client.name,
      legalName: client.legalName,
      internalCode: client.internalCode,
      industry: client.industry,
      status: client.status,
      configurationStatus,
      domainCount: clientDomains.length,
      mailboxCount: clientMailboxes.length,
      assignedExecutiveCount: clientAssignments.length,
    };
  }
}
