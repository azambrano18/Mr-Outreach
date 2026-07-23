import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CrmClientsService } from '../crm-clients/crm-clients.service';
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

@Injectable()
export class AdminClientsService {
  constructor(
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly assignments: ClientExecutiveAssignmentRepository,
    private readonly crmClients: CrmClientsService,
  ) {}

  async list(organizationId: string, search?: string): Promise<AdminClientsListResult> {
    const crmRows = await this.tryFetchCrm(() => this.crmClients.list(search));
    if (!crmRows) {
      return { available: false, clients: [] };
    }

    const [localClients, allDomains, allMailboxes] = await Promise.all([
      this.managedClients.findAll(organizationId),
      this.domains.findAll(organizationId),
      this.mailboxes.findAll(organizationId),
    ]);
    const byCrmId = new Map(localClients.map((c) => [c.crmClientId, c]));

    const clients = await Promise.all(
      crmRows.map((row) =>
        this.buildOverview(
          row.crmClientId,
          row.name,
          row.rut,
          row.rubro,
          row.status,
          byCrmId.get(row.crmClientId) ?? null,
          allDomains,
          allMailboxes,
        ),
      ),
    );

    return { available: true, clients };
  }

  async getByCrmClientId(organizationId: string, crmClientId: number): Promise<AdminClientOverview> {
    const crmClient = await this.crmClients.getById(crmClientId); // 404s if it doesn't exist in the CRM at all
    const local = await this.managedClients.findByCrmClientId(organizationId, crmClientId);
    const [allDomains, allMailboxes] = await Promise.all([
      this.domains.findAll(organizationId),
      this.mailboxes.findAll(organizationId),
    ]);

    return this.buildOverview(
      crmClient.crmClientId,
      crmClient.name,
      crmClient.rut,
      crmClient.rubro,
      crmClient.status,
      local,
      allDomains,
      allMailboxes,
    );
  }

  private async buildOverview(
    crmClientId: number,
    name: string,
    rut: string | null,
    rubro: string | null,
    crmStatus: string,
    local: ManagedClient | null,
    allDomains: Domain[],
    allMailboxes: Mailbox[],
  ): Promise<AdminClientOverview> {
    if (!local) {
      return {
        crmClientId,
        name,
        rut,
        rubro,
        crmStatus,
        managedClientId: null,
        configurationStatus: 'SIN_CONFIGURAR',
        domainCount: 0,
        mailboxCount: 0,
        assignedExecutiveCount: 0,
      };
    }

    const clientDomains = allDomains.filter((d) => d.clientId === local.id);
    const clientMailboxes = allMailboxes.filter((m) => m.clientId === local.id);
    const clientAssignments = await this.assignments.findByClient(local.id);

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
      crmClientId,
      name,
      rut,
      rubro,
      crmStatus,
      managedClientId: local.id,
      configurationStatus,
      domainCount: clientDomains.length,
      mailboxCount: clientMailboxes.length,
      assignedExecutiveCount: clientAssignments.length,
    };
  }

  /** Turns a CRM outage into `{available:false}` (200) instead of a hard 500 — never surfaces the raw driver error. */
  private async tryFetchCrm<T>(fetcher: () => Promise<T>): Promise<T | null> {
    try {
      return await fetcher();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return null;
      }
      throw error;
    }
  }
}
