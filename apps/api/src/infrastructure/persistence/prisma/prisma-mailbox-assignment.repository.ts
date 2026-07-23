import { Injectable } from '@nestjs/common';
import {
  CreateMailboxAssignmentInput,
  MailboxAssignment,
  MailboxAssignmentRole,
} from '../../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../../domain/mailbox-assignment/mailbox-assignment.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaMailboxAssignmentRepository implements MailboxAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: CreateMailboxAssignmentInput): Promise<MailboxAssignment> {
    const row = await this.prisma.mailboxAssignment.upsert({
      where: { mailboxId_userId: { mailboxId: input.mailboxId, userId: input.userId } },
      create: {
        organizationId: input.organizationId,
        mailboxId: input.mailboxId,
        userId: input.userId,
        role: input.role,
        assignedBy: input.assignedBy,
      },
      update: { role: input.role, assignedBy: input.assignedBy, assignedAt: new Date() },
    });
    return this.toDomain(row);
  }

  async remove(mailboxId: string, userId: string): Promise<void> {
    await this.prisma.mailboxAssignment.deleteMany({ where: { mailboxId, userId } });
  }

  async findByMailbox(mailboxId: string): Promise<MailboxAssignment[]> {
    const rows = await this.prisma.mailboxAssignment.findMany({ where: { mailboxId } });
    return rows.map((row) => this.toDomain(row));
  }

  async findByUser(userId: string): Promise<MailboxAssignment[]> {
    const rows = await this.prisma.mailboxAssignment.findMany({ where: { userId } });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: {
    id: string;
    organizationId: string;
    mailboxId: string;
    userId: string;
    role: string;
    assignedBy: string;
    assignedAt: Date;
  }): MailboxAssignment {
    return {
      id: row.id,
      organizationId: row.organizationId,
      mailboxId: row.mailboxId,
      userId: row.userId,
      role: row.role as MailboxAssignmentRole,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
    };
  }
}
