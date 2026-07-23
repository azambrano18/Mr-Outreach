import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MailboxConnectionTest,
  RecordMailboxConnectionTestInput,
} from '../../../domain/mailbox/mailbox-connection-test.entity';
import { MailboxConnectionTestRepository } from '../../../domain/mailbox/mailbox-connection-test.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryMailboxConnectionTestRepository implements MailboxConnectionTestRepository {
  constructor(private readonly store: MemoryStore) {}

  async record(input: RecordMailboxConnectionTestInput): Promise<MailboxConnectionTest> {
    const entry: MailboxConnectionTest = {
      id: randomUUID(),
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
      createdAt: new Date(),
    };
    this.store.mailboxConnectionTests.push(entry);
    return entry;
  }

  async findByMailbox(mailboxId: string): Promise<MailboxConnectionTest[]> {
    return this.store.mailboxConnectionTests
      .filter((entry) => entry.mailboxId === mailboxId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}
