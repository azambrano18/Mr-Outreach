import { Injectable } from '@nestjs/common';
import { EmailBodyAsset as PrismaEmailBodyAssetRow } from '@prisma/client';
import {
  CreateEmailBodyAssetInput,
  EmailBodyAsset,
  EmailBodyAssetStatus,
  UpdateEmailBodyAssetInput,
} from '../../../domain/email-body-asset/email-body-asset.entity';
import { EmailBodyAssetRepository } from '../../../domain/email-body-asset/email-body-asset.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaEmailBodyAssetRow): EmailBodyAsset {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    objectKey: row.objectKey,
    publicUrl: row.publicUrl,
    contentType: row.contentType as EmailBodyAsset['contentType'],
    originalFileName: row.originalFileName,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    status: row.status as EmailBodyAssetStatus,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaEmailBodyAssetRepository implements EmailBodyAssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateEmailBodyAssetInput): Promise<EmailBodyAsset> {
    const row = await this.prisma.emailBodyAsset.create({
      data: {
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
      },
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<EmailBodyAsset | null> {
    const row = await this.prisma.emailBodyAsset.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByObjectKey(objectKey: string): Promise<EmailBodyAsset | null> {
    const row = await this.prisma.emailBodyAsset.findUnique({ where: { objectKey } });
    return row ? toDomain(row) : null;
  }

  async findByOrganization(organizationId: string): Promise<EmailBodyAsset[]> {
    const rows = await this.prisma.emailBodyAsset.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async update(id: string, input: UpdateEmailBodyAssetInput): Promise<EmailBodyAsset> {
    const row = await this.prisma.emailBodyAsset.update({
      where: { id },
      data: { status: input.status, deletedAt: input.deletedAt },
    });
    return toDomain(row);
  }
}
