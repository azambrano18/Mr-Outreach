import { Injectable } from '@nestjs/common';
import { Prisma, SequenceTemplateVersion as PrismaVersionRow } from '@prisma/client';
import {
  CreateSequenceTemplateVersionInput,
  SequenceTemplateVersion,
  SequenceTemplateVersionStatus,
  SequenceTemplateVersionStepSnapshot,
  SequenceTemplateVersionVariable,
  UpdateSequenceTemplateVersionInput,
} from '../../../domain/sequence-template/sequence-template-version.entity';
import { SequenceTemplateVersionRepository } from '../../../domain/sequence-template/sequence-template-version.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaVersionRow): SequenceTemplateVersion {
  return {
    id: row.id,
    templateId: row.templateId,
    versionNumber: row.versionNumber,
    name: row.name,
    mailboxId: row.mailboxId,
    timezone: row.timezone,
    subjectTemplate: row.subjectTemplate,
    headerText: row.headerText,
    signatureHtml: row.signatureHtml,
    variables: row.variables as unknown as SequenceTemplateVersionVariable[],
    steps: row.steps as unknown as SequenceTemplateVersionStepSnapshot[],
    status: row.status as SequenceTemplateVersionStatus,
    serverTemplateId: row.serverTemplateId,
    templateTokenCiphertext: row.templateTokenCiphertext,
    acceptedAt: row.acceptedAt,
    lastPublishCommandId: row.lastPublishCommandId,
    lastError: row.lastError,
    previousVersionNumber: row.previousVersionNumber,
    effectiveScope: row.effectiveScope as 'FUTURE_UNSENT_JOBS' | null,
    affectedExecutions: row.affectedExecutions,
    affectedPendingJobs: row.affectedPendingJobs,
    unchangedSentJobs: row.unchangedSentJobs,
    processingJobsNotChanged: row.processingJobsNotChanged,
    appliedAt: row.appliedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaSequenceTemplateVersionRepository implements SequenceTemplateVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<SequenceTemplateVersion | null> {
    const row = await this.prisma.sequenceTemplateVersion.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByTemplate(templateId: string): Promise<SequenceTemplateVersion[]> {
    const rows = await this.prisma.sequenceTemplateVersion.findMany({
      where: { templateId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map(toDomain);
  }

  async findLatestByTemplate(templateId: string): Promise<SequenceTemplateVersion | null> {
    const row = await this.prisma.sequenceTemplateVersion.findFirst({
      where: { templateId },
      orderBy: { versionNumber: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async findByServerTemplateId(serverTemplateId: string): Promise<SequenceTemplateVersion | null> {
    const row = await this.prisma.sequenceTemplateVersion.findUnique({ where: { serverTemplateId } });
    return row ? toDomain(row) : null;
  }

  async create(input: CreateSequenceTemplateVersionInput): Promise<SequenceTemplateVersion> {
    const latest = await this.findLatestByTemplate(input.templateId);
    const row = await this.prisma.sequenceTemplateVersion.create({
      data: {
        templateId: input.templateId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        name: input.name,
        mailboxId: input.mailboxId,
        timezone: input.timezone,
        subjectTemplate: input.subjectTemplate,
        signatureHtml: input.signatureHtml,
        variables: input.variables as unknown as Prisma.InputJsonValue,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        lastPublishCommandId: input.lastPublishCommandId,
        createdBy: input.createdBy,
        previousVersionNumber: input.previousVersionNumber ?? null,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceTemplateVersionInput): Promise<SequenceTemplateVersion> {
    const row = await this.prisma.sequenceTemplateVersion.update({
      where: { id },
      data: {
        status: input.status,
        serverTemplateId: input.serverTemplateId,
        templateTokenCiphertext: input.templateTokenCiphertext,
        acceptedAt: input.acceptedAt,
        lastError: input.lastError,
        effectiveScope: input.effectiveScope,
        affectedExecutions: input.affectedExecutions,
        affectedPendingJobs: input.affectedPendingJobs,
        unchangedSentJobs: input.unchangedSentJobs,
        processingJobsNotChanged: input.processingJobsNotChanged,
        appliedAt: input.appliedAt,
      },
    });
    return toDomain(row);
  }
}
