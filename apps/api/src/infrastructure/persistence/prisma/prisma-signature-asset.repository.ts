import { Injectable } from '@nestjs/common';
import { SignatureAsset as PrismaSignatureAssetRow } from '@prisma/client';
import {
  CreateSignatureAssetInput,
  SignatureAsset,
  SignatureAssetStatus,
  UpdateSignatureAssetInput,
} from '../../../domain/signature-asset/signature-asset.entity';
import { SignatureAssetRepository } from '../../../domain/signature-asset/signature-asset.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSignatureAssetRow): SignatureAsset {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    mailboxId: row.mailboxId,
    objectKey: row.objectKey,
    publicUrl: row.publicUrl,
    contentType: row.contentType as SignatureAsset['contentType'],
    originalFileName: row.originalFileName,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    status: row.status as SignatureAssetStatus,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaSignatureAssetRepository implements SignatureAssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSignatureAssetInput): Promise<SignatureAsset> {
    const row = await this.prisma.signatureAsset.create({
      data: {
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
      },
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<SignatureAsset | null> {
    const row = await this.prisma.signatureAsset.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByObjectKey(objectKey: string): Promise<SignatureAsset | null> {
    const row = await this.prisma.signatureAsset.findUnique({ where: { objectKey } });
    return row ? toDomain(row) : null;
  }

  async findByOrganization(organizationId: string): Promise<SignatureAsset[]> {
    const rows = await this.prisma.signatureAsset.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async update(id: string, input: UpdateSignatureAssetInput): Promise<SignatureAsset> {
    const row = await this.prisma.signatureAsset.update({
      where: { id },
      data: { status: input.status, deletedAt: input.deletedAt },
    });
    return toDomain(row);
  }
}
