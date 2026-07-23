import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSequenceStepVersionInput,
  SequenceStepVersion,
} from '../../../domain/sequence/sequence-step-version.entity';
import { SequenceStepVersionRepository } from '../../../domain/sequence/sequence-step-version.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySequenceStepVersionRepository implements SequenceStepVersionRepository {
  constructor(private readonly store: MemoryStore) {}

  async create(input: CreateSequenceStepVersionInput): Promise<SequenceStepVersion> {
    const existingCount = this.store.sequenceStepVersions.filter(
      (version) => version.sequenceStepId === input.sequenceStepId,
    ).length;

    const version: SequenceStepVersion = {
      id: randomUUID(),
      sequenceStepId: input.sequenceStepId,
      versionNumber: existingCount + 1,
      subject: input.subject,
      preheader: input.preheader,
      htmlHeader: input.htmlHeader ?? null,
      htmlBody: input.htmlBody,
      plainTextBody: input.plainTextBody,
      delayValue: input.delayValue,
      delayUnit: input.delayUnit,
      sendMode: input.sendMode,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    this.store.sequenceStepVersions.push(version);
    return version;
  }

  async findByStep(sequenceStepId: string): Promise<SequenceStepVersion[]> {
    return this.store.sequenceStepVersions
      .filter((version) => version.sequenceStepId === sequenceStepId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }
}
