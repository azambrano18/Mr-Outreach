import { Injectable } from '@nestjs/common';
import { SequenceTemplateStep as PrismaStepRow } from '@prisma/client';
import {
  CreateSequenceTemplateStepInput,
  SequenceTemplateStep,
  SequenceTemplateStepDelayReference,
  SequenceTemplateStepDelayUnit,
  UpdateSequenceTemplateStepInput,
  Weekday,
} from '../../../domain/sequence-template/sequence-template-step.entity';
import { SequenceTemplateStepRepository } from '../../../domain/sequence-template/sequence-template-step.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaStepRow): SequenceTemplateStep {
  return {
    id: row.id,
    organizationId: row.organizationId,
    templateId: row.templateId,
    stepNumber: row.stepNumber as 1 | 2 | 3,
    name: row.name,
    enabled: row.enabled,
    subjectTemplate: row.subjectTemplate,
    headerHtml: row.headerHtml,
    headerText: row.headerText,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    delayValue: row.delayValue,
    delayUnit: row.delayUnit as SequenceTemplateStepDelayUnit,
    delayReference: row.delayReference as SequenceTemplateStepDelayReference,
    allowedWeekdays: row.allowedWeekdays as Weekday[],
    sendWindowStart: row.sendWindowStart,
    sendWindowEnd: row.sendWindowEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaSequenceTemplateStepRepository implements SequenceTemplateStepRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTemplate(templateId: string): Promise<SequenceTemplateStep[]> {
    const rows = await this.prisma.sequenceTemplateStep.findMany({
      where: { templateId },
      orderBy: { stepNumber: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<SequenceTemplateStep | null> {
    const row = await this.prisma.sequenceTemplateStep.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async create(input: CreateSequenceTemplateStepInput): Promise<SequenceTemplateStep> {
    const row = await this.prisma.sequenceTemplateStep.create({
      data: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        stepNumber: input.stepNumber,
        name: input.name,
        delayValue: input.stepNumber === 1 ? 0 : 5,
        delayReference: input.stepNumber === 1 ? 'EXECUTION_START' : 'PREVIOUS_STEP',
        allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        sendWindowStart: input.stepNumber === 1 ? '00:00' : '08:00',
        sendWindowEnd: '19:00',
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceTemplateStepInput): Promise<SequenceTemplateStep> {
    const row = await this.prisma.sequenceTemplateStep.update({
      where: { id },
      data: {
        name: input.name,
        enabled: input.enabled,
        subjectTemplate: input.subjectTemplate,
        headerText: input.headerText,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        delayValue: input.delayValue,
        delayUnit: input.delayUnit,
        delayReference: input.delayReference,
        allowedWeekdays: input.allowedWeekdays,
        sendWindowStart: input.sendWindowStart,
        sendWindowEnd: input.sendWindowEnd,
      },
    });
    return toDomain(row);
  }

  async deleteByTemplate(templateId: string): Promise<void> {
    await this.prisma.sequenceTemplateStep.deleteMany({ where: { templateId } });
  }
}
