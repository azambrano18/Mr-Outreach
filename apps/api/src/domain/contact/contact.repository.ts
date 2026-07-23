import { Contact, CreateContactInput, UpdateContactInput } from './contact.entity';

export interface ContactRepository {
  findById(id: string): Promise<Contact | null>;
  /** Dedup scope is (organization, client, email) — the same prospect can legitimately exist under two different managed clients. */
  findByEmail(organizationId: string, clientId: string, email: string): Promise<Contact | null>;
  findByClient(organizationId: string, clientId: string): Promise<Contact[]>;
  create(input: CreateContactInput): Promise<Contact>;
  update(id: string, input: UpdateContactInput): Promise<Contact>;
}
