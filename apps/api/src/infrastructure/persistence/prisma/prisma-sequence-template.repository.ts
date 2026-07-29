import { Injectable } from '@nestjs/common';
import { SequenceTemplate as PrismaSequenceTemplateRow } from '@prisma/client';
import { TransactionContext } from '../../../domain/persistence/transaction';
import {
  CreateSequenceTemplateInput,
  SequenceTemplate,
  SequenceTemplateStatus,
  UpdateSequenceTemplateInput,
} from '../../../domain/sequence-template/sequence-template.entity';
import { SequenceTemplateRepository } from '../../../domain/sequence-template/sequence-template.repository';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaSequenceTemplateRow): SequenceTemplate {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    mailboxId: row.mailboxId,
    name: row.name,
    description: row.description,
    subjectTemplate: row.subjectTemplate,
    headerText: row.headerText,
    signatureHtml: row.signatureHtml,
    status: row.status as SequenceTemplateStatus,
    currentDraftVersion: row.currentDraftVersion,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaSequenceTemplateRepository implements SequenceTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<SequenceTemplate | null> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequenceTemplate.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByOwner(organizationId: string, ownerUserId: string): Promise<SequenceTemplate[]> {
    const rows = await this.prisma.sequenceTemplate.findMany({ where: { organizationId, ownerUserId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async findByMailbox(organizationId: string, mailboxId: string): Promise<SequenceTemplate[]> {
    const rows = await this.prisma.sequenceTemplate.findMany({ where: { organizationId, mailboxId } });
    return rows.map(toDomain);
  }

  async create(input: CreateSequenceTemplateInput): Promise<SequenceTemplate> {
    const row = await this.prisma.sequenceTemplate.create({
      data: {
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        mailboxId: input.mailboxId,
        name: input.name,
        description: input.description ?? null,
        timezone: input.timezone,
        signatureHtml: input.signatureHtml,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceTemplateInput, ctx?: TransactionContext): Promise<SequenceTemplate> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequenceTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        subjectTemplate: input.subjectTemplate,
        signatureHtml: input.signatureHtml,
        status: input.status,
        currentDraftVersion: input.currentDraftVersion,
        archivedAt: input.archivedAt,
        deletedAt: input.deletedAt,
      },
    });
    return toDomain(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.sequenceTemplate.delete({ where: { id } });
  }

  async conditionalUpdateStatus(
    id: string,
    blockedStatuses: SequenceTemplateStatus[],
    toStatus: SequenceTemplateStatus,
    ctx?: TransactionContext,
  ): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.sequenceTemplate.updateMany({
      where: { id, status: { notIn: blockedStatuses } },
      data: { status: toStatus },
    });
    return result.count;
  }
}
