import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { CrmClientEligibilityService } from './crm-client-eligibility.service';
import { CrmClientsService } from './crm-clients.service';

describe('CrmClientEligibilityService', () => {
  let crmClients: jest.Mocked<Pick<CrmClientsService, 'getById'>>;
  let config: jest.Mocked<Pick<AppConfigService, 'crmActiveStatusValue'>>;
  let service: CrmClientEligibilityService;

  const buildCrmClient = (overrides: Partial<CrmClient> = {}): CrmClient => ({
    crmClientId: 1001,
    name: 'Acme Inc',
    rut: '76.123.456-7',
    rubro: 'Tecnología',
    status: 'ACTIVO',
    ...overrides,
  });

  beforeEach(() => {
    crmClients = { getById: jest.fn() };
    config = {} as jest.Mocked<Pick<AppConfigService, 'crmActiveStatusValue'>>;
    Object.defineProperty(config, 'crmActiveStatusValue', { get: () => 'ACTIVO' });
    service = new CrmClientEligibilityService(
      crmClients as unknown as CrmClientsService,
      config as unknown as AppConfigService,
    );
  });

  describe('getVerifiedActiveClient', () => {
    it('returns the CRM client when status is exactly ACTIVO', async () => {
      crmClients.getById.mockResolvedValue(buildCrmClient({ status: 'ACTIVO' }));

      const result = await service.getVerifiedActiveClient(1001);

      expect(result.crmClientId).toBe(1001);
    });

    it('accepts a lowercase status ("activo")', async () => {
      crmClients.getById.mockResolvedValue(buildCrmClient({ status: 'activo' }));

      await expect(service.getVerifiedActiveClient(1001)).resolves.toBeDefined();
    });

    it('accepts a status with surrounding whitespace (" ACTIVO ")', async () => {
      crmClients.getById.mockResolvedValue(buildCrmClient({ status: ' ACTIVO ' }));

      await expect(service.getVerifiedActiveClient(1001)).resolves.toBeDefined();
    });

    it('rejects an inactive client with 409 Conflict', async () => {
      crmClients.getById.mockResolvedValue(buildCrmClient({ status: 'INACTIVO' }));

      await expect(service.getVerifiedActiveClient(1001)).rejects.toThrow(ConflictException);
    });

    it('rejects an unrecognized/unknown status value', async () => {
      crmClients.getById.mockResolvedValue(buildCrmClient({ status: 'SUSPENDIDO' }));

      await expect(service.getVerifiedActiveClient(1001)).rejects.toThrow(ConflictException);
    });

    it('propagates 404 for a nonexistent CRM client without converting it', async () => {
      crmClients.getById.mockRejectedValue(new NotFoundException('CRM client not found.'));

      await expect(service.getVerifiedActiveClient(9999)).rejects.toThrow(NotFoundException);
    });

    it('propagates 503 when the CRM is unreachable, without converting it', async () => {
      crmClients.getById.mockRejectedValue(new ServiceUnavailableException('CRM temporarily unavailable.'));

      await expect(service.getVerifiedActiveClient(1001)).rejects.toThrow(ServiceUnavailableException);
    });

    it('propagates a timeout-shaped failure as 503, not as "inactive"', async () => {
      crmClients.getById.mockRejectedValue(new ServiceUnavailableException('CRM temporarily unavailable.'));

      await expect(service.getVerifiedActiveClient(1001)).rejects.toThrow(ServiceUnavailableException);
      await expect(service.getVerifiedActiveClient(1001)).rejects.not.toThrow(ConflictException);
    });

    it('never converts an unrelated/unexpected error into "unavailable"', async () => {
      crmClients.getById.mockRejectedValue(new Error('boom - unrelated bug'));

      await expect(service.getVerifiedActiveClient(1001)).rejects.toThrow('boom - unrelated bug');
    });

    it('has no side effects — never calls anything beyond CrmClientsService.getById', async () => {
      crmClients.getById.mockResolvedValue(buildCrmClient());

      await service.getVerifiedActiveClient(1001);

      expect(crmClients.getById).toHaveBeenCalledTimes(1);
      expect(crmClients.getById).toHaveBeenCalledWith(1001);
    });
  });

  describe('verify', () => {
    it('returns { active: false } instead of throwing, for ClientsService to still read the raw CRM client', async () => {
      const crmClient = buildCrmClient({ status: 'INACTIVO' });
      crmClients.getById.mockResolvedValue(crmClient);

      const result = await service.verify(1001);

      expect(result.active).toBe(false);
      expect(result.crmClient).toEqual(crmClient);
    });

    it('still propagates 404/503 (verify is not a "safe" wrapper for infra failures)', async () => {
      crmClients.getById.mockRejectedValue(new NotFoundException());
      await expect(service.verify(1001)).rejects.toThrow(NotFoundException);
    });
  });

  describe('isActive', () => {
    it('normalizes both sides with TRIM + UPPER before comparing', () => {
      expect(service.isActive(buildCrmClient({ status: ' activo ' }))).toBe(true);
      expect(service.isActive(buildCrmClient({ status: 'Inactivo' }))).toBe(false);
    });
  });
});
