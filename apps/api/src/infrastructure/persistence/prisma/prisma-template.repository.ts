import { Injectable } from '@nestjs/common';
import { Template as PrismaTemplateRow } from '@prisma/client';
import {
  CreateTemplateInput,
  Template,
  UpdateTemplateInput,
} from '../../../domain/template/template.entity';
import { TemplateRepository } from '../../../domain/template/template.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaTemplateRow): Template {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaTemplateRepository implements TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Template | null> {
    const row = await this.prisma.template.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<Template[]> {
    const rows = await this.prisma.template.findMany({
      where: { organizationId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async create(input: CreateTemplateInput): Promise<Template> {
    const row = await this.prisma.template.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        subject: input.subject,
        body: input.body,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateTemplateInput): Promise<Template> {
    const row = await this.prisma.template.update({
      where: { id },
      data: {
        name: input.name,
        subject: input.subject,
        body: input.body,
        status: input.status,
      },
    });
    return toDomain(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.template.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
