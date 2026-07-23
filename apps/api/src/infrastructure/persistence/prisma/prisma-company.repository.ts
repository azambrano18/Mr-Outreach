import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Company as PrismaCompanyRow } from '@prisma/client';
import {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
  normalizeCompanyName,
} from '../../../domain/company/company.entity';
import { CompanyRepository } from '../../../domain/company/company.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaCompanyRow): Company {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    rawName: row.rawName,
    normalizedName: row.normalizedName,
    suppressed: row.suppressed,
    suppressedAt: row.suppressedAt,
    suppressedReason: row.suppressedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaCompanyRepository implements CompanyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Company | null> {
    const row = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByNormalizedName(
    organizationId: string,
    clientId: string,
    normalizedName: string,
  ): Promise<Company | null> {
    const row = await this.prisma.company.findFirst({
      where: { organizationId, clientId, normalizedName, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findByClient(organizationId: string, clientId: string): Promise<Company[]> {
    const rows = await this.prisma.company.findMany({ where: { organizationId, clientId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    try {
      const row = await this.prisma.company.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          rawName: input.rawName,
          normalizedName: normalizeCompanyName(input.rawName),
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A company with this normalized name already exists for this client.');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateCompanyInput): Promise<Company> {
    const row = await this.prisma.company.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
