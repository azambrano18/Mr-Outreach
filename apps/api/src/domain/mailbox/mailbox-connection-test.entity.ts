import { MailboxConnectionStatus } from './mailbox.entity';

export interface MailboxConnectionTest {
  id: string;
  organizationId: string;
  mailboxId: string;
  /** Always a terminal result — never NOT_TESTED or TESTING. */
  status: Exclude<MailboxConnectionStatus, 'NOT_TESTED' | 'TESTING'>;
  imapSuccess: boolean;
  imapErrorCode: string | null;
  smtpSuccess: boolean;
  smtpErrorCode: string | null;
  /** Comprensible — safe to show as-is in the UI. */
  message: string;
  /** Diagnostic detail for troubleshooting — still never contains a secret. */
  technicalMessage: string;
  executedBy: string;
  createdAt: Date;
}

export interface RecordMailboxConnectionTestInput {
  organizationId: string;
  mailboxId: string;
  status: MailboxConnectionTest['status'];
  imapSuccess: boolean;
  imapErrorCode?: string | null;
  smtpSuccess: boolean;
  smtpErrorCode?: string | null;
  message: string;
  technicalMessage: string;
  executedBy: string;
}
