import { CreateMailboxInput, Mailbox, UpdateMailboxInput } from './mailbox.entity';

export interface MailboxRepository {
  findById(id: string): Promise<Mailbox | null>;
  findByEmail(organizationId: string, email: string): Promise<Mailbox | null>;
  findAll(organizationId: string): Promise<Mailbox[]>;
  create(input: CreateMailboxInput): Promise<Mailbox>;
  update(id: string, input: UpdateMailboxInput): Promise<Mailbox>;
}
