import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { Domain } from '../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { CrmClientsService } from '../crm-clients/crm-clients.service';
import { AdminClientsService } from './admin-clients.service';

describe('AdminClientsService', () => {
  let managedClients: jest.Mocked<ManagedClientRepository>;
  let domains: jest.Mocked<DomainRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
  let crmClients: jest.Mocked<CrmClientsService>;
  let service: AdminClientsService;

  const orgId = 'org_1';

  beforeEach(() => {
    managedClients = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByCrmClientId: jest.fn(), findByServerClientId: jest.fn(),
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
    crmClients = { list: jest.fn(), getById: jest.fn() } as unknown as jest.Mocked<CrmClientsService>;

    service = new AdminClientsService(managedClients, domains, mailboxes, assignments, crmClients);
  });

  describe('list', () => {
    it('returns available:false (never a hard error) when the CRM connection fails', async () => {
      crmClients.list.mockRejectedValue(new ServiceUnavailableException('CRM temporarily unavailable.'));

      const result = await service.list(orgId);

      expect(result).toEqual({ available: false, clients: [] });
    });

    it('propagates unexpected errors instead of masking them as "unavailable"', async () => {
      crmClients.list.mockRejectedValue(new Error('boom'));

      await expect(service.list(orgId)).rejects.toThrow('boom');
    });

    it('marks a CRM row with no local ManagedClient as SIN_CONFIGURAR', async () => {
      crmClients.list.mockResolvedValue([
        { crmClientId: 1, name: 'Acme', rut: null, rubro: null, status: 'ACTIVO' },
      ]);
      managedClients.findAll.mockResolvedValue([]);
      domains.findAll.mockResolvedValue([]);
      mailboxes.findAll.mockResolvedValue([]);

      const result = await service.list(orgId);

      expect(result.available).toBe(true);
      expect(result.clients[0]).toMatchObject({
        crmClientId: 1,
        configurationStatus: 'SIN_CONFIGURAR',
        managedClientId: null,
      });
    });

    it('marks a configured client missing domains/mailboxes/executives as CONFIGURACION_INCOMPLETA', async () => {
      const local: ManagedClient = {
        id: 'client_1',
        organizationId: orgId,
        crmClientId: 1,
        source: 'LEGACY_CRM',
        serverClientId: null,
        name: 'Acme',
        legalName: null,
        internalCode: null,
        industry: null,
        status: 'ACTIVE',
        logoUrl: null,
        startDate: null,
        supervisorUserId: null,
        notes: null,
        crmRutSnapshot: null,
        crmStatusSnapshot: null,
        crmStatusCheckedAt: null,
        createdBy: 'admin',
        updatedBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      crmClients.list.mockResolvedValue([
        { crmClientId: 1, name: 'Acme', rut: null, rubro: null, status: 'ACTIVO' },
      ]);
      managedClients.findAll.mockResolvedValue([local]);
      domains.findAll.mockResolvedValue([]);
      mailboxes.findAll.mockResolvedValue([]);
      assignments.findByClient.mockResolvedValue([]);

      const result = await service.list(orgId);

      expect(result.clients[0].configurationStatus).toBe('CONFIGURACION_INCOMPLETA');
      expect(result.clients[0].managedClientId).toBe('client_1');
    });

    it('marks a client with a mailbox connection error as CON_INCIDENCIAS even if otherwise complete', async () => {
      const local: ManagedClient = {
        id: 'client_1',
        organizationId: orgId,
        crmClientId: 1,
        source: 'LEGACY_CRM',
        serverClientId: null,
        name: 'Acme',
        legalName: null,
        internalCode: null,
        industry: null,
        status: 'ACTIVE',
        logoUrl: null,
        startDate: null,
        supervisorUserId: null,
        notes: null,
        crmRutSnapshot: null,
        crmStatusSnapshot: null,
        crmStatusCheckedAt: null,
        createdBy: 'admin',
        updatedBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
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

      crmClients.list.mockResolvedValue([
        { crmClientId: 1, name: 'Acme', rut: null, rubro: null, status: 'ACTIVO' },
      ]);
      managedClients.findAll.mockResolvedValue([local]);
      domains.findAll.mockResolvedValue([domain]);
      mailboxes.findAll.mockResolvedValue([mailbox]);
      assignments.findByClient.mockResolvedValue([{ id: 'a1' } as never]);

      const result = await service.list(orgId);

      expect(result.clients[0].configurationStatus).toBe('CON_INCIDENCIAS');
    });
  });

  describe('getByCrmClientId', () => {
    it('propagates NotFoundException when the CRM client does not exist at all', async () => {
      crmClients.getById.mockRejectedValue(new NotFoundException('CRM client not found.'));

      await expect(service.getByCrmClientId(orgId, 999)).rejects.toThrow(NotFoundException);
    });
  });
});
