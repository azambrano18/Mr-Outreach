import { ConflictException, NotFoundException } from '@nestjs/common';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { ClientsService } from './clients.service';

describe('ClientsService (Fase 1.5)', () => {
  let clients: jest.Mocked<ManagedClientRepository>;
  let assignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
  let domains: jest.Mocked<Pick<DomainRepository, 'findByClient'>>;
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findAll'>>;
  let sequences: jest.Mocked<Pick<SequenceRepository, 'findByClient'>>;
  let conversations: jest.Mocked<Pick<ConversationRepository, 'findAll'>>;
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let crmEligibility: jest.Mocked<Pick<CrmClientEligibilityService, 'getVerifiedActiveClient' | 'verify'>>;
  let service: ClientsService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildCrmClient = (overrides: Partial<CrmClient> = {}): CrmClient => ({
    crmClientId: 1001,
    name: 'Acme Inc',
    rut: '76.123.456-7',
    rubro: 'Tecnología',
    status: 'ACTIVO',
    ...overrides,
  });

  const buildManagedClient = (overrides: Partial<ManagedClient> = {}): ManagedClient => ({
    id: 'client_1',
    organizationId: orgId,
    crmClientId: 1001,
    source: 'LEGACY_CRM',
    serverClientId: null,
    name: 'Acme Inc',
    legalName: null,
    internalCode: null,
    industry: 'Tecnología',
    status: 'ACTIVE',
    logoUrl: null,
    startDate: null,
    supervisorUserId: null,
    notes: null,
    crmRutSnapshot: '76.123.456-7',
    crmStatusSnapshot: 'ACTIVO',
    crmStatusCheckedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'admin_1',
    updatedBy: 'admin_1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    clients = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByCrmClientId: jest.fn(),
      findByServerClientId: jest.fn(),
    };
    assignments = {
      findByClient: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<ClientExecutiveAssignmentRepository>;
    domains = { findByClient: jest.fn().mockResolvedValue([]) };
    mailboxes = { findAll: jest.fn().mockResolvedValue([]) };
    sequences = { findByClient: jest.fn().mockResolvedValue([]) };
    conversations = { findAll: jest.fn().mockResolvedValue([]) };
    users = { findById: jest.fn() };
    auditLogs = { record: jest.fn(), findAll: jest.fn() } as unknown as jest.Mocked<AuditLogRepository>;
    crmEligibility = { getVerifiedActiveClient: jest.fn(), verify: jest.fn() };

    service = new ClientsService(
      clients,
      assignments,
      domains as unknown as DomainRepository,
      mailboxes as unknown as MailboxRepository,
      sequences as unknown as SequenceRepository,
      conversations as unknown as ConversationRepository,
      users as unknown as UserRepository,
      auditLogs,
      crmEligibility as unknown as CrmClientEligibilityService,
    );
  });

  describe('create (activación)', () => {
    it('creates a new ManagedClient from the verified CRM client on first activation', async () => {
      const crmClient = buildCrmClient();
      crmEligibility.getVerifiedActiveClient.mockResolvedValue(crmClient);
      clients.findByCrmClientId.mockResolvedValue(null);
      clients.create.mockResolvedValue(buildManagedClient());

      await service.create(orgId, { crmClientId: 1001 }, 'admin_1');

      expect(crmEligibility.getVerifiedActiveClient).toHaveBeenCalledWith(1001);
      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          crmClientId: 1001,
          name: 'Acme Inc',
          industry: 'Tecnología',
          crmRutSnapshot: '76.123.456-7',
          crmStatusSnapshot: 'ACTIVO',
          createdBy: 'admin_1',
        }),
        undefined,
      );
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'client.activate' }),
      );
    });

    it('is idempotent: activating an already-configured client updates instead of duplicating', async () => {
      const crmClient = buildCrmClient({ name: 'Acme Incorporated' });
      const existing = buildManagedClient();
      crmEligibility.getVerifiedActiveClient.mockResolvedValue(crmClient);
      clients.findByCrmClientId.mockResolvedValue(existing);
      clients.update.mockResolvedValue({ ...existing, name: 'Acme Incorporated' });

      await service.create(orgId, { crmClientId: 1001 }, 'admin_1');

      expect(clients.create).not.toHaveBeenCalled();
      expect(clients.update).toHaveBeenCalledWith(
        existing.id,
        expect.objectContaining({ name: 'Acme Incorporated', updatedBy: 'admin_1' }),
        undefined,
      );
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'client.crm_sync' }),
      );
    });

    it('never creates/updates a ManagedClient when the CRM client is inactive', async () => {
      crmEligibility.getVerifiedActiveClient.mockRejectedValue(
        new ConflictException('Este cliente está inactivo en el CRM y no admite nuevas configuraciones.'),
      );

      await expect(service.create(orgId, { crmClientId: 1001 }, 'admin_1')).rejects.toThrow(ConflictException);

      expect(clients.create).not.toHaveBeenCalled();
      expect(clients.update).not.toHaveBeenCalled();
      expect(auditLogs.record).not.toHaveBeenCalled();
    });
  });

  describe('upsertFromVerifiedCrmClient', () => {
    it('sets operational fields only on first creation', async () => {
      clients.findByCrmClientId.mockResolvedValue(null);
      clients.create.mockResolvedValue(buildManagedClient());

      await service.upsertFromVerifiedCrmClient(orgId, buildCrmClient(), 'admin_1', {
        legalName: 'Acme Legal SpA',
        notes: 'VIP',
      });

      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({ legalName: 'Acme Legal SpA', notes: 'VIP' }),
        undefined,
      );
    });

    it('preserves operational fields and relations on update — only overwrites the CRM snapshot', async () => {
      const existing = buildManagedClient({ legalName: 'Acme Legal SpA', notes: 'VIP', internalCode: 'INT-1' });
      clients.findByCrmClientId.mockResolvedValue(existing);
      clients.update.mockResolvedValue(existing);

      await service.upsertFromVerifiedCrmClient(orgId, buildCrmClient({ rut: '76.999.999-9' }), 'admin_1');

      const updateCall = clients.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('legalName');
      expect(updateCall).not.toHaveProperty('notes');
      expect(updateCall).not.toHaveProperty('internalCode');
      expect(updateCall.crmRutSnapshot).toBe('76.999.999-9');
    });

    it('preserves createdBy/createdAt on update (update() only patches the fields given)', async () => {
      const existing = buildManagedClient();
      clients.findByCrmClientId.mockResolvedValue(existing);
      clients.update.mockResolvedValue(existing);

      await service.upsertFromVerifiedCrmClient(orgId, buildCrmClient(), 'someone_else');

      const updateCall = clients.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('createdBy');
      expect(updateCall).not.toHaveProperty('createdAt');
    });
  });

  describe('assertClientCrmEligible', () => {
    it('refreshes the CRM snapshot and does not throw when active', async () => {
      const managed = buildManagedClient();
      clients.findById.mockResolvedValue(managed);
      crmEligibility.verify.mockResolvedValue({ crmClient: buildCrmClient(), active: true });
      clients.update.mockResolvedValue(managed);

      await expect(service.assertClientCrmEligible(orgId, managed.id, 'admin_1')).resolves.toBeUndefined();

      expect(clients.update).toHaveBeenCalledWith(
        managed.id,
        expect.objectContaining({ crmStatusSnapshot: 'ACTIVO', updatedBy: 'admin_1' }),
      );
    });

    it('refreshes the CRM snapshot to reflect "inactive" AND still blocks the operation (§11)', async () => {
      const managed = buildManagedClient();
      clients.findById.mockResolvedValue(managed);
      crmEligibility.verify.mockResolvedValue({
        crmClient: buildCrmClient({ status: 'INACTIVO' }),
        active: false,
      });
      clients.update.mockResolvedValue(managed);

      await expect(service.assertClientCrmEligible(orgId, managed.id, 'admin_1')).rejects.toThrow(
        ConflictException,
      );

      expect(clients.update).toHaveBeenCalledWith(
        managed.id,
        expect.objectContaining({ crmStatusSnapshot: 'INACTIVO' }),
      );
    });

    it('404s (never leaks) for a ManagedClient belonging to another organization', async () => {
      const managed = buildManagedClient({ organizationId: otherOrgId });
      clients.findById.mockResolvedValue(managed);

      await expect(service.assertClientCrmEligible(orgId, managed.id, 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(crmEligibility.verify).not.toHaveBeenCalled();
    });
  });
});
