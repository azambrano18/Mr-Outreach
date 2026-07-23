import {
  CreateScheduledEmailInput,
  ScheduledEmail,
  UpdateScheduledEmailInput,
} from './scheduled-email.entity';

export interface ScheduledEmailFilter {
  status?: string;
  sequenceContactId?: string;
  mailboxId?: string;
  batchId?: string;
  sequenceId?: string;
  companyId?: string;
}

export interface ScheduledEmailRepository {
  findById(id: string): Promise<ScheduledEmail | null>;
  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<ScheduledEmail | null>;
  findBySequenceContact(sequenceContactId: string): Promise<ScheduledEmail[]>;
  findAll(organizationId: string, filter?: ScheduledEmailFilter): Promise<ScheduledEmail[]>;
  create(input: CreateScheduledEmailInput): Promise<ScheduledEmail>;
  update(id: string, input: UpdateScheduledEmailInput): Promise<ScheduledEmail>;
}
