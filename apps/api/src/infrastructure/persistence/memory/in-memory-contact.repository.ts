import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Contact,
  CreateContactInput,
  UpdateContactInput,
} from '../../../domain/contact/contact.entity';
import { ContactRepository } from '../../../domain/contact/contact.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryContactRepository implements ContactRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Contact | null> {
    const contact = this.store.contacts.get(id);
    return contact && !contact.deletedAt ? contact : null;
  }

  async findByEmail(
    organizationId: string,
    clientId: string,
    email: string,
  ): Promise<Contact | null> {
    const normalized = email.toLowerCase();
    for (const contact of this.store.contacts.values()) {
      if (
        !contact.deletedAt &&
        contact.organizationId === organizationId &&
        contact.clientId === clientId &&
        contact.email.toLowerCase() === normalized
      ) {
        return contact;
      }
    }
    return null;
  }

  async findByClient(organizationId: string, clientId: string): Promise<Contact[]> {
    return Array.from(this.store.contacts.values()).filter(
      (contact) =>
        !contact.deletedAt &&
        contact.organizationId === organizationId &&
        contact.clientId === clientId,
    );
  }

  async create(input: CreateContactInput): Promise<Contact> {
    const existing = await this.findByEmail(input.organizationId, input.clientId, input.email);
    if (existing) {
      throw new ConflictException('A contact with this email already exists for this client.');
    }

    const now = new Date();
    const contact: Contact = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      companyId: input.companyId,
      email: input.email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      fullName: input.fullName ?? null,
      jobTitle: input.jobTitle ?? null,
      phone: input.phone ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      website: input.website ?? null,
      linkedin: input.linkedin ?? null,
      customFields: input.customFields ?? {},
      suppressed: false,
      suppressedAt: null,
      suppressedReason: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.contacts.set(contact.id, contact);
    return contact;
  }

  async update(id: string, input: UpdateContactInput): Promise<Contact> {
    const existing = this.store.contacts.get(id);
    if (!existing) {
      throw new NotFoundException('Contact not found.');
    }
    const updated: Contact = { ...existing, ...input, updatedAt: new Date() };
    this.store.contacts.set(id, updated);
    return updated;
  }
}
