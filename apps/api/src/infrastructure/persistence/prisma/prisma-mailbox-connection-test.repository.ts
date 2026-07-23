import { Injectable } from '@nestjs/common';
import {
  MailboxConnectionTest,
  RecordMailboxConnectionTestInput,
} from '../../../domain/mailbox/mailbox-connection-test.entity';
import { MailboxConnectionTestRepository } from '../../../domain/mailbox/mailbox-connection-test.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaMailboxConnectionTestRepository implements MailboxConnectionTestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordMailboxConnectionTestInput): Promise<MailboxConnectionTest> {
    const row = await this.prisma.mailboxConnectionTest.create({
      data: {
        organizationId: input.organizationId,
        mailboxId: input.mailboxId,
        status: input.status,
        imapSuccess: input.imapSuccess,
        imapErrorCode: input.imapErrorCode ?? null,
        smtpSuccess: input.smtpSuccess,
        smtpErrorCode: input.smtpErrorCode ?? null,
        message: input.message,
        technicalMessage: input.technicalMessage,
        executedBy: input.executedBy,
      },
    });
    return row as MailboxConnectionTest;
  }

  async findByMailbox(mailboxId: string): Promise<MailboxConnectionTest[]> {
    const rows = await this.prisma.mailboxConnectionTest.findMany({
      where: { mailboxId },
      orderBy: { createdAt: 'desc' },
    });
    return rows as MailboxConnectionTest[];
  }
}
