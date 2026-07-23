import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, SequenceContact as PrismaSequenceContactRow } from '@prisma/client';
import {
  CreateSequenceContactInput,
  SequenceContact,
  UpdateSequenceContactInput,
} from '../../../domain/sequence-contact/sequence-contact.entity';
import {
  SequenceContactFilter,
  SequenceContactRepository,
} from '../../../domain/sequence-contact/sequence-contact.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSequenceContactRow): SequenceContact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    sequenceId: row.sequenceId,
    sequenceVersion: row.sequenceVersion,
    contactId: row.contactId,
    companyId: row.companyId,
    sourceImportId: row.sourceImportId,
    assignedMailboxId: row.assignedMailboxId,
    assignedExecutiveId: row.assignedExecutiveId,
    currentStepId: row.currentStepId,
    currentStepPosition: row.currentStepPosition,
    status: row.status,
    nextScheduledAt: row.nextScheduledAt,
    startedAt: row.startedAt,
    lastSentAt: row.lastSentAt,
    repliedAt: row.repliedAt,
    completedAt: row.completedAt,
    stoppedAt: row.stoppedAt,
    stopReason: row.stopReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaSequenceContactRepository implements SequenceContactRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<SequenceContact | null> {
    const row = await this.prisma.sequenceContact.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySequence(
    organizationId: string,
    sequenceId: string,
    filter: SequenceContactFilter = {},
  ): Promise<SequenceContact[]> {
    const where: Prisma.SequenceContactWhereInput = { organizationId, sequenceId };
    if (filter.companyId) where.companyId = filter.companyId;
    if (filter.status) where.status = filter.status as never;
    const rows = await this.prisma.sequenceContact.findMany({ where });
    return rows.map(toDomain);
  }

  async findByContactAndSequence(sequenceId: string, contactId: string): Promise<SequenceContact | null> {
    const row = await this.prisma.sequenceContact.findUnique({
      where: { sequenceId_contactId: { sequenceId, contactId } },
    });
    return row ? toDomain(row) : null;
  }

  async findByContact(organizationId: string, contactId: string): Promise<SequenceContact[]> {
    const rows = await this.prisma.sequenceContact.findMany({ where: { organizationId, contactId } });
    return rows.map(toDomain);
  }

  async findAllByOrganization(organizationId: string): Promise<SequenceContact[]> {
    const rows = await this.prisma.sequenceContact.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async create(input: CreateSequenceContactInput): Promise<SequenceContact> {
    try {
      const row = await this.prisma.sequenceContact.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          sequenceId: input.sequenceId,
          sequenceVersion: input.sequenceVersion,
          contactId: input.contactId,
          companyId: input.companyId,
          sourceImportId: input.sourceImportId ?? null,
          assignedMailboxId: input.assignedMailboxId,
          assignedExecutiveId: input.assignedExecutiveId,
          currentStepId: input.currentStepId,
          currentStepPosition: input.currentStepPosition,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This contact is already enrolled in this sequence.');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateSequenceContactInput): Promise<SequenceContact> {
    const row = await this.prisma.sequenceContact.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
