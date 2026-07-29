import { Injectable } from '@nestjs/common';
import { SequenceStep as PrismaSequenceStepRow } from '@prisma/client';
import { TransactionContext } from '../../../domain/persistence/transaction';
import {
  CreateSequenceStepInput,
  DelayUnit,
  SequenceStep,
  SequenceStepStatus,
  StepSendMode,
  UpdateSequenceStepInput,
} from '../../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../../domain/sequence/sequence-step.repository';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaSequenceStepRow): SequenceStep {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sequenceId: row.sequenceId,
    position: row.position,
    name: row.name,
    subject: row.subject,
    preheader: row.preheader,
    htmlHeader: row.htmlHeader,
    htmlBody: row.htmlBody,
    plainTextBody: row.plainTextBody,
    delayValue: row.delayValue,
    delayUnit: row.delayUnit as DelayUnit,
    sendMode: row.sendMode as StepSendMode,
    status: row.status as SequenceStepStatus,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaSequenceStepRepository implements SequenceStepRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<SequenceStep | null> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequenceStep.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findBySequence(sequenceId: string, ctx?: TransactionContext): Promise<SequenceStep[]> {
    const client = resolveClient(this.prisma, ctx);
    const rows = await client.sequenceStep.findMany({
      where: { sequenceId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findAllByOrganization(organizationId: string): Promise<SequenceStep[]> {
    const rows = await this.prisma.sequenceStep.findMany({
      where: { organizationId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async create(input: CreateSequenceStepInput): Promise<SequenceStep> {
    const row = await this.prisma.sequenceStep.create({
      data: {
        organizationId: input.organizationId,
        sequenceId: input.sequenceId,
        position: input.position,
        name: input.name,
        subject: input.subject,
        preheader: input.preheader ?? null,
        htmlHeader: input.htmlHeader ?? null,
        htmlBody: input.htmlBody,
        plainTextBody: input.plainTextBody,
        delayValue: input.delayValue,
        delayUnit: input.delayUnit,
        sendMode: input.sendMode,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceStepInput): Promise<SequenceStep> {
    const row = await this.prisma.sequenceStep.update({ where: { id }, data: input });
    return toDomain(row);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.sequenceStep.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
