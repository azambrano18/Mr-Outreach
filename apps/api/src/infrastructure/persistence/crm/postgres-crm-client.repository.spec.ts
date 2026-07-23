import { ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PostgresCrmClientRepository } from './postgres-crm-client.repository';

const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    end: mockEnd,
  })),
}));

describe('PostgresCrmClientRepository', () => {
  const SECRET_CONNECTION_STRING = 'postgresql://crm_reader:super-secret-password@ep-example.neon.tech/CRM';

  function buildConfig(): AppConfigService {
    return {
      crmDatabaseUrl: SECRET_CONNECTION_STRING,
      crmActiveStatusValue: 'ACTIVO',
    } as unknown as AppConfigService;
  }

  beforeEach(() => {
    mockQuery.mockReset();
    mockEnd.mockReset();
  });

  it('never lets the raw driver error (which may embed the connection string) escape findAllActive', async () => {
    mockQuery.mockRejectedValue(new Error(`connection failed: ${SECRET_CONNECTION_STRING}`));
    const repository = new PostgresCrmClientRepository(buildConfig());

    await expect(repository.findAllActive()).rejects.toThrow(ServiceUnavailableException);
    await expect(repository.findAllActive()).rejects.not.toThrow(
      expect.objectContaining({ message: expect.stringContaining(SECRET_CONNECTION_STRING) }),
    );
  });

  it('never lets the raw driver error escape findById', async () => {
    mockQuery.mockRejectedValue(new Error(`connection failed: ${SECRET_CONNECTION_STRING}`));
    const repository = new PostgresCrmClientRepository(buildConfig());

    await expect(repository.findById(1)).rejects.toThrow(ServiceUnavailableException);
    let caught: unknown;
    try {
      await repository.findById(1);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).not.toContain(SECRET_CONNECTION_STRING);
    expect((caught as Error).message).not.toContain('super-secret-password');
  });

  it('maps rows to the domain shape on success', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 1001, empresa: 'Litoral Software', rut: '76.123.456-7', rubro: 'Tecnología', status: 'ACTIVO' }],
    });
    const repository = new PostgresCrmClientRepository(buildConfig());

    const result = await repository.findAllActive();

    expect(result).toEqual([
      { crmClientId: 1001, name: 'Litoral Software', rut: '76.123.456-7', rubro: 'Tecnología', status: 'ACTIVO' },
    ]);
  });

  it('passes the configured active-status value and search term as query parameters, never string-concatenated', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const repository = new PostgresCrmClientRepository(buildConfig());

    await repository.findAllActive({ search: "Robert'); DROP TABLE maestro_clientes;--" });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toEqual(['ACTIVO', "Robert'); DROP TABLE maestro_clientes;--"]);
  });
});
