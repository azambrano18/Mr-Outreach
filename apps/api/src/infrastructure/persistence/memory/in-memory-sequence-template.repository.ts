import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceTemplateInput,
  SequenceTemplate,
  SequenceTemplateStatus,
  UpdateSequenceTemplateInput,
} from '../../../domain/sequence-template/sequence-template.entity';
import { SequenceTemplateRepository } from '../../../domain/sequence-template/sequence-template.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceTemplateRepository implements SequenceTemplateRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceTemplate | null> {
    const template = this.store.sequenceTemplates.get(id);
    return template && !template.deletedAt ? template : null;
  }

  async findByOwner(organizationId: string, ownerUserId: string): Promise<SequenceTemplate[]> {
    return [...this.store.sequenceTemplates.values()].filter(
      (t) => t.organizationId === organizationId && t.ownerUserId === ownerUserId && !t.deletedAt,
    );
  }

  async findByMailbox(organizationId: string, mailboxId: string): Promise<SequenceTemplate[]> {
    return [...this.store.sequenceTemplates.values()].filter(
      (t) => t.organizationId === organizationId && t.mailboxId === mailboxId,
    );
  }

  async create(input: CreateSequenceTemplateInput): Promise<SequenceTemplate> {
    const now = new Date();
    const template: SequenceTemplate = {
      id: randomUUID(),
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      mailboxId: input.mailboxId,
      name: input.name,
      description: input.description ?? null,
      subjectTemplate: '',
      headerText: null,
      signatureHtml: input.signatureHtml,
      status: 'DRAFT',
      currentDraftVersion: 1,
      timezone: input.timezone,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    };
    this.store.sequenceTemplates.set(template.id, template);
    return template;
  }

  async update(id: string, input: UpdateSequenceTemplateInput): Promise<SequenceTemplate> {
    const existing = this.store.sequenceTemplates.get(id);
    if (!existing) throw new Error(`SequenceTemplate ${id} not found`);
    // A key present with value `undefined` means "not sent, leave unchanged" (mirrors Prisma's own
    // undefined-skipping semantics) — a plain `{...existing, ...input}` spread would instead wipe that
    // field to `undefined`, since object spread copies a key regardless of its value.
    const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const updated: SequenceTemplate = {
      ...existing,
      ...definedInput,
      updatedAt: new Date(),
    };
    this.store.sequenceTemplates.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.sequenceTemplates.delete(id);
  }

  async conditionalUpdateStatus(
    id: string,
    blockedStatuses: SequenceTemplateStatus[],
    toStatus: SequenceTemplateStatus,
  ): Promise<number> {
    const existing = this.store.sequenceTemplates.get(id);
    if (!existing) return 0;
    if (blockedStatuses.includes(existing.status)) return 0;
    this.store.sequenceTemplates.set(id, { ...existing, status: toStatus, updatedAt: new Date() });
    return 1;
  }
}
