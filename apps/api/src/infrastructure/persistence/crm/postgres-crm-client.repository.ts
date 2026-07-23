import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { CrmClient } from '../../../domain/crm-client/crm-client.entity';
import { CrmClientFilter, CrmClientRepository } from '../../../domain/crm-client/crm-client.repository';
import { AppConfigService } from '../../config/app-config.service';

interface MaestroClientesRow {
  id: number;
  empresa: string;
  rut: string | null;
  rubro: string | null;
  status: string;
}

function toDomain(row: MaestroClientesRow): CrmClient {
  return { crmClientId: row.id, name: row.empresa, rut: row.rut, rubro: row.rubro, status: row.status };
}

/**
 * Only ever constructed when CRM_DRIVER=postgres (see PersistenceModule) —
 * a raw `pg` pool, deliberately NOT Prisma: `prisma/schema.prisma` already
 * has one `datasource` block pointed at the app's own DATABASE_URL, and
 * Prisma cannot multiplex a second live database in the same generated
 * client. This is a separate, unrelated, read-only external database Mr
 * Outreach does not own — only explicitly-selected columns are ever
 * queried, never `SELECT *`.
 */
@Injectable()
export class PostgresCrmClientRepository implements CrmClientRepository, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostgresCrmClientRepository.name);
  private readonly pool: Pool;

  constructor(private readonly config: AppConfigService) {
    this.pool = new Pool({ connectionString: config.crmDatabaseUrl });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.logger.log('Connected to the CRM (Neon) database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async findAllActive(filter: CrmClientFilter = {}): Promise<CrmClient[]> {
    try {
      const search = filter.search?.trim() || null;
      const result = await this.pool.query<MaestroClientesRow>(
        `SELECT id, empresa, rut, rubro, status
         FROM maestro_clientes
         WHERE UPPER(TRIM(status)) = UPPER($1)
           AND ($2::text IS NULL OR empresa ILIKE '%' || $2 || '%')
         ORDER BY empresa`,
        [this.config.crmActiveStatusValue, search],
      );
      return result.rows.map(toDomain);
    } catch {
      // Never forward the driver's raw error — some pg failure paths embed the connection string.
      this.logger.error('CRM query failed (findAllActive)');
      throw new ServiceUnavailableException('CRM temporarily unavailable.');
    }
  }

  async findById(crmClientId: number): Promise<CrmClient | null> {
    try {
      const result = await this.pool.query<MaestroClientesRow>(
        'SELECT id, empresa, rut, rubro, status FROM maestro_clientes WHERE id = $1',
        [crmClientId],
      );
      return result.rows[0] ? toDomain(result.rows[0]) : null;
    } catch {
      this.logger.error('CRM query failed (findById)');
      throw new ServiceUnavailableException('CRM temporarily unavailable.');
    }
  }
}
