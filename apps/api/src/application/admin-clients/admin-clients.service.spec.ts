import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { Domain } from '../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { AdminClientsService } from './admin-clients.service';

describe('AdminClientsService', () => {
  let managedClients: jest.Mocked<ManagedClientRepository>;
  let domains: jest.Mocked<DomainRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
  let service: AdminClientsService;

  const orgId = 'org_1';

  function buildClient(overrides: Partial<ManagedClient> = {}): ManagedClient {
    return {
      id: 'client_1',
      organizationId: orgId,
      source: 'SERVER',
      serverClientId: 'srv_1',
      name: 'Acme',
      legalName: null,
      internalCode: null,
      industry: null,
      status: 'ACTIVE',
      logoUrl: null,
      startDate: null,
      supervisorUserId: null,
      notes: null,
      clientRutSnapshot: null,
      externalStatusSnapshot: null,
      externalStatusCheckedAt: null,
      createdBy: 'admin',
      updatedBy: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    managedClients = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByServerClientId: jest.fn(),
    };
    domains = {
      findById: jest.fn(),
      findByClient: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mailboxes = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<MailboxRepository>;
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByClient: jest.fn(),
      findByUser: jest.fn(),
      ensureDerivedVisibility: jest.fn(),
      removeDerivedVisibilityIfPresent: jest.fn(),
    };

    service = new AdminClientsService(managedClients, domains, mailboxes, assignments);
  });

  describe('list', () => {
    it('marks a client missing domains/mailboxes/executives as CONFIGURACION_INCOMPLETA', async () => {
      managedClients.findAll.mockResolvedValue([buildClient()]);
      domains.findAll.mockResolvedValue([]);
      mailboxes.findAll.mockResolvedValue([]);
      assignments.findByClient.mockResolvedValue([]);

      const result = await service.list(orgId);

      expect(result.available).toBe(true);
      expect(result.clients[0]).toMatchObject({ id: 'client_1', configurationStatus: 'CONFIGURACION_INCOMPLETA' });
    });

    it('marks a fully-configured client as CONFIGURADO', async () => {
      const domain: Domain = {
        id: 'domain_1',
        organizationId: orgId,
        clientId: 'client_1',
        domainName: 'acme.cl',
        status: 'ACTIVE',
        notes: null,
        createdBy: 'admin',
        updatedBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      const mailbox = { clientId: 'client_1', connectionStatus: 'CONNECTED', provisioningStatus: 'PROVISIONED' } as Mailbox;

      managedClients.findAll.mockResolvedValue([buildClient()]);
      domains.findAll.mockResolvedValue([domain]);
      mailboxes.findAll.mockResolvedValue([mailbox]);
      assignments.findByClient.mockResolvedValue([{ id: 'a1' } as never]);

      const result = await service.list(orgId);

      expect(result.clients[0].configurationStatus).toBe('CONFIGURADO');
    });

    it('marks a client with a mailbox connection error as CON_INCIDENCIAS even if otherwise complete', async () => {
      const domain: Domain = {
        id: 'domain_1',
        organizationId: orgId,
        clientId: 'client_1',
        domainName: 'acme.cl',
        status: 'ACTIVE',
        notes: null,
        createdBy: 'admin',
        updatedBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      const mailbox = { clientId: 'client_1', connectionStatus: 'CONNECTION_ERROR', provisioningStatus: 'PROVISIONED' } as Mailbox;

      managedClients.findAll.mockResolvedValue([buildClient()]);
      domains.findAll.mockResolvedValue([domain]);
      mailboxes.findAll.mockResolvedValue([mailbox]);
      assignments.findByClient.mockResolvedValue([{ id: 'a1' } as never]);

      const result = await service.list(orgId);

      expect(result.clients[0].configurationStatus).toBe('CON_INCIDENCIAS');
    });

    it('filters by search term against name/internalCode', async () => {
      managedClients.findAll.mockResolvedValue([
        buildClient({ id: 'client_1', name: 'Acme' }),
        buildClient({ id: 'client_2', name: 'Otra Empresa' }),
      ]);
      domains.findAll.mockResolvedValue([]);
      mailboxes.findAll.mockResolvedValue([]);
      assignments.findByClient.mockResolvedValue([]);

      const result = await service.list(orgId, 'acme');

      expect(result.clients).toHaveLength(1);
      expect(result.clients[0].id).toBe('client_1');
    });
  });
});
