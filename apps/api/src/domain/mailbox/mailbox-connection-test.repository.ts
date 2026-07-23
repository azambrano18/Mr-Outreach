import {
  MailboxConnectionTest,
  RecordMailboxConnectionTestInput,
} from './mailbox-connection-test.entity';

export interface MailboxConnectionTestRepository {
  record(input: RecordMailboxConnectionTestInput): Promise<MailboxConnectionTest>;
  /** Most recent first. */
  findByMailbox(mailboxId: string): Promise<MailboxConnectionTest[]>;
}
