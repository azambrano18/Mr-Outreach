import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSignatureVersionInput,
  SignatureVersion,
} from '../../../domain/signature/signature-version.entity';
import { SignatureVersionRepository } from '../../../domain/signature/signature-version.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySignatureVersionRepository implements SignatureVersionRepository {
  constructor(private readonly store: MemoryStore) {}

  async create(input: CreateSignatureVersionInput): Promise<SignatureVersion> {
    const existingCount = this.store.signatureVersions.filter(
      (version) => version.signatureId === input.signatureId,
    ).length;

    const version: SignatureVersion = {
      id: randomUUID(),
      signatureId: input.signatureId,
      versionNumber: existingCount + 1,
      htmlContent: input.htmlContent,
      plainTextContent: input.plainTextContent,
      createdAt: new Date(),
      createdBy: input.createdBy,
    };
    this.store.signatureVersions.push(version);
    return version;
  }

  async findById(id: string): Promise<SignatureVersion | null> {
    return this.store.signatureVersions.find((version) => version.id === id) ?? null;
  }

  async findBySignature(signatureId: string): Promise<SignatureVersion[]> {
    return this.store.signatureVersions
      .filter((version) => version.signatureId === signatureId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }
}
