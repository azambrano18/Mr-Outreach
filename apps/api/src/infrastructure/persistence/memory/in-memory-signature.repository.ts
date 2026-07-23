import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSignatureInput,
  Signature,
  UpdateSignatureInput,
} from '../../../domain/signature/signature.entity';
import { SignatureRepository } from '../../../domain/signature/signature.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySignatureRepository implements SignatureRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Signature | null> {
    return this.store.signatures.get(id) ?? null;
  }

  async findByMailbox(mailboxId: string): Promise<Signature | null> {
    for (const signature of this.store.signatures.values()) {
      if (signature.mailboxId === mailboxId) {
        return signature;
      }
    }
    return null;
  }

  async findAllByOrganization(organizationId: string): Promise<Signature[]> {
    return Array.from(this.store.signatures.values()).filter(
      (signature) => signature.organizationId === organizationId,
    );
  }

  async create(input: CreateSignatureInput): Promise<Signature> {
    const existing = await this.findByMailbox(input.mailboxId);
    if (existing) {
      throw new ConflictException('This mailbox already has a signature.');
    }

    const now = new Date();
    const signature: Signature = {
      id: randomUUID(),
      organizationId: input.organizationId,
      mailboxId: input.mailboxId,
      status: 'ACTIVE',
      activeVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.signatures.set(signature.id, signature);
    return signature;
  }

  async update(id: string, input: UpdateSignatureInput): Promise<Signature> {
    const existing = this.store.signatures.get(id);
    if (!existing) {
      throw new ConflictException('Signature not found.');
    }

    const updated: Signature = { ...existing, ...input, updatedAt: new Date() };
    this.store.signatures.set(id, updated);
    return updated;
  }
}
