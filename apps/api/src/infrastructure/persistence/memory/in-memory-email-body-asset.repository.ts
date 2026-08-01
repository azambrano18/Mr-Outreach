import { Injectable } from '@nestjs/common';
import {
  CreateEmailBodyAssetInput,
  EmailBodyAsset,
  UpdateEmailBodyAssetInput,
} from '../../../domain/email-body-asset/email-body-asset.entity';
import { EmailBodyAssetRepository } from '../../../domain/email-body-asset/email-body-asset.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryEmailBodyAssetRepository implements EmailBodyAssetRepository {
  constructor(private readonly store: MemoryStore) {}

  async create(input: CreateEmailBodyAssetInput): Promise<EmailBodyAsset> {
    const asset: EmailBodyAsset = {
      id: input.id,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      objectKey: input.objectKey,
      publicUrl: input.publicUrl,
      contentType: input.contentType,
      originalFileName: input.originalFileName,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      status: 'AVAILABLE',
      createdAt: new Date(),
      deletedAt: null,
    };
    this.store.emailBodyAssets.set(asset.id, asset);
    return asset;
  }

  async findById(id: string): Promise<EmailBodyAsset | null> {
    return this.store.emailBodyAssets.get(id) ?? null;
  }

  async findByObjectKey(objectKey: string): Promise<EmailBodyAsset | null> {
    return [...this.store.emailBodyAssets.values()].find((a) => a.objectKey === objectKey) ?? null;
  }

  async findByOrganization(organizationId: string): Promise<EmailBodyAsset[]> {
    return [...this.store.emailBodyAssets.values()].filter((a) => a.organizationId === organizationId);
  }

  async update(id: string, input: UpdateEmailBodyAssetInput): Promise<EmailBodyAsset> {
    const existing = this.store.emailBodyAssets.get(id);
    if (!existing) throw new Error(`EmailBodyAsset ${id} not found`);
    const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const updated: EmailBodyAsset = { ...existing, ...definedInput };
    this.store.emailBodyAssets.set(id, updated);
    return updated;
  }
}
