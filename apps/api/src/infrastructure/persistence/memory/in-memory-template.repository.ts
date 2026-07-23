import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateTemplateInput,
  Template,
  UpdateTemplateInput,
} from '../../../domain/template/template.entity';
import { TemplateRepository } from '../../../domain/template/template.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryTemplateRepository implements TemplateRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Template | null> {
    const template = this.store.templates.get(id);
    return template && !template.deletedAt ? template : null;
  }

  async findAll(organizationId: string): Promise<Template[]> {
    return Array.from(this.store.templates.values()).filter(
      (template) => !template.deletedAt && template.organizationId === organizationId,
    );
  }

  async create(input: CreateTemplateInput): Promise<Template> {
    const now = new Date();
    const template: Template = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      subject: input.subject,
      body: input.body,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.templates.set(template.id, template);
    return template;
  }

  async update(id: string, input: UpdateTemplateInput): Promise<Template> {
    const existing = this.store.templates.get(id);
    if (!existing || existing.deletedAt) {
      throw new ConflictException('Template not found.');
    }

    const updated: Template = { ...existing, ...input, updatedAt: new Date() };
    this.store.templates.set(id, updated);
    return updated;
  }

  async softDelete(id: string): Promise<void> {
    const existing = this.store.templates.get(id);
    if (!existing || existing.deletedAt) {
      return;
    }
    this.store.templates.set(id, { ...existing, deletedAt: new Date(), updatedAt: new Date() });
  }
}
