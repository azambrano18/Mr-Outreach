import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceTemplateVersionInput,
  SequenceTemplateVersion,
  UpdateSequenceTemplateVersionInput,
} from '../../../domain/sequence-template/sequence-template-version.entity';
import { SequenceTemplateVersionRepository } from '../../../domain/sequence-template/sequence-template-version.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceTemplateVersionRepository implements SequenceTemplateVersionRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SequenceTemplateVersion | null> {
    return this.store.sequenceTemplateVersions.get(id) ?? null;
  }

  async findByTemplate(templateId: string): Promise<SequenceTemplateVersion[]> {
    return [...this.store.sequenceTemplateVersions.values()]
      .filter((v) => v.templateId === templateId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async findLatestByTemplate(templateId: string): Promise<SequenceTemplateVersion | null> {
    const versions = await this.findByTemplate(templateId);
    return versions[0] ?? null;
  }

  async findByServerTemplateId(serverTemplateId: string): Promise<SequenceTemplateVersion | null> {
    return (
      [...this.store.sequenceTemplateVersions.values()].find((v) => v.serverTemplateId === serverTemplateId) ?? null
    );
  }

  async create(input: CreateSequenceTemplateVersionInput): Promise<SequenceTemplateVersion> {
    const existingCount = [...this.store.sequenceTemplateVersions.values()].filter(
      (v) => v.templateId === input.templateId,
    ).length;

    const version: SequenceTemplateVersion = {
      id: randomUUID(),
      templateId: input.templateId,
      versionNumber: existingCount + 1,
      name: input.name,
      mailboxId: input.mailboxId,
      timezone: input.timezone,
      subjectTemplate: input.subjectTemplate,
      headerText: null,
      signatureHtml: input.signatureHtml,
      variables: input.variables,
      steps: input.steps,
      status: 'REQUESTED',
      serverTemplateId: null,
      templateTokenCiphertext: null,
      acceptedAt: null,
      lastPublishCommandId: input.lastPublishCommandId,
      lastError: null,
      previousVersionNumber: input.previousVersionNumber ?? null,
      effectiveScope: null,
      affectedExecutions: null,
      affectedPendingJobs: null,
      unchangedSentJobs: null,
      processingJobsNotChanged: null,
      appliedAt: null,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    this.store.sequenceTemplateVersions.set(version.id, version);
    return version;
  }

  async update(id: string, input: UpdateSequenceTemplateVersionInput): Promise<SequenceTemplateVersion> {
    const existing = this.store.sequenceTemplateVersions.get(id);
    if (!existing) throw new Error(`SequenceTemplateVersion ${id} not found`);
    const updated: SequenceTemplateVersion = { ...existing, ...input };
    this.store.sequenceTemplateVersions.set(id, updated);
    return updated;
  }
}
