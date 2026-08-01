import { Injectable } from '@nestjs/common';
import {
  CreateSignatureAssetInput,
  SignatureAsset,
  UpdateSignatureAssetInput,
} from '../../../domain/signature-asset/signature-asset.entity';
import { SignatureAssetRepository } from '../../../domain/signature-asset/signature-asset.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySignatureAssetRepository implements SignatureAssetRepository {
  constructor(private readonly store: MemoryStore) {}

  async create(input: CreateSignatureAssetInput): Promise<SignatureAsset> {
    const asset: SignatureAsset = {
      id: input.id,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      mailboxId: input.mailboxId,
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
    this.store.signatureAssets.set(asset.id, asset);
    return asset;
  }

  async findById(id: string): Promise<SignatureAsset | null> {
    return this.store.signatureAssets.get(id) ?? null;
  }

  async findByObjectKey(objectKey: string): Promise<SignatureAsset | null> {
    return [...this.store.signatureAssets.values()].find((a) => a.objectKey === objectKey) ?? null;
  }

  async findByOrganization(organizationId: string): Promise<SignatureAsset[]> {
    return [...this.store.signatureAssets.values()].filter((a) => a.organizationId === organizationId);
  }

  async update(id: string, input: UpdateSignatureAssetInput): Promise<SignatureAsset> {
    const existing = this.store.signatureAssets.get(id);
    if (!existing) throw new Error(`SignatureAsset ${id} not found`);
    const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const updated: SignatureAsset = { ...existing, ...definedInput };
    this.store.signatureAssets.set(id, updated);
    return updated;
  }
}
