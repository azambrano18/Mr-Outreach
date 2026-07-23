import { Injectable } from '@nestjs/common';
import { SequenceStepVersion as PrismaSequenceStepVersionRow } from '@prisma/client';
import {
  CreateSequenceStepVersionInput,
  SequenceStepVersion,
} from '../../../domain/sequence/sequence-step-version.entity';
import { SequenceStepVersionRepository } from '../../../domain/sequence/sequence-step-version.repository';
import { DelayUnit, StepSendMode } from '../../../domain/sequence/sequence-step.entity';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSequenceStepVersionRow): SequenceStepVersion {
  return {
    id: row.id,
    sequenceStepId: row.sequenceStepId,
    versionNumber: row.versionNumber,
    subject: row.subject,
    preheader: row.preheader,
    htmlHeader: row.htmlHeader,
    htmlBody: row.htmlBody,
    plainTextBody: row.plainTextBody,
    delayValue: row.delayValue,
    delayUnit: row.delayUnit as DelayUnit,
    sendMode: row.sendMode as StepSendMode,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaSequenceStepVersionRepository implements SequenceStepVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSequenceStepVersionInput): Promise<SequenceStepVersion> {
    const count = await this.prisma.sequenceStepVersion.count({
      where: { sequenceStepId: input.sequenceStepId },
    });
    const row = await this.prisma.sequenceStepVersion.create({
      data: {
        sequenceStepId: input.sequenceStepId,
        versionNumber: count + 1,
        subject: input.subject,
        preheader: input.preheader,
        htmlHeader: input.htmlHeader ?? null,
        htmlBody: input.htmlBody,
        plainTextBody: input.plainTextBody,
        delayValue: input.delayValue,
        delayUnit: input.delayUnit,
        sendMode: input.sendMode,
        createdBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async findByStep(sequenceStepId: string): Promise<SequenceStepVersion[]> {
    const rows = await this.prisma.sequenceStepVersion.findMany({
      where: { sequenceStepId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map(toDomain);
  }
}
