import { Injectable } from '@nestjs/common';
import { Variable as PrismaVariableRow } from '@prisma/client';
import {
  CreateVariableInput,
  UpdateVariableInput,
  Variable,
} from '../../../domain/variable/variable.entity';
import { VariableRepository } from '../../../domain/variable/variable.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaVariableRow): Variable {
  return {
    id: row.id,
    organizationId: row.organizationId,
    key: row.key,
    label: row.label,
    description: row.description,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaVariableRepository implements VariableRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Variable | null> {
    const row = await this.prisma.variable.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByKey(organizationId: string, key: string): Promise<Variable | null> {
    const row = await this.prisma.variable.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<Variable[]> {
    const rows = await this.prisma.variable.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async create(input: CreateVariableInput): Promise<Variable> {
    const row = await this.prisma.variable.create({
      data: {
        organizationId: input.organizationId,
        key: input.key,
        label: input.label,
        description: input.description ?? null,
        source: input.source,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateVariableInput): Promise<Variable> {
    const row = await this.prisma.variable.update({
      where: { id },
      data: {
        key: input.key,
        label: input.label,
        description: input.description,
        source: input.source,
        status: input.status,
      },
    });
    return toDomain(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.variable.delete({ where: { id } });
  }
}
