import { Injectable } from '@nestjs/common';
import { SignatureVersion as PrismaSignatureVersionRow } from '@prisma/client';
import {
  CreateSignatureVersionInput,
  SignatureVersion,
} from '../../../domain/signature/signature-version.entity';
import { SignatureVersionRepository } from '../../../domain/signature/signature-version.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSignatureVersionRow): SignatureVersion {
  return {
    id: row.id,
    signatureId: row.signatureId,
    versionNumber: row.versionNumber,
    htmlContent: row.htmlContent,
    plainTextContent: row.plainTextContent,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

@Injectable()
export class PrismaSignatureVersionRepository implements SignatureVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSignatureVersionInput): Promise<SignatureVersion> {
    const count = await this.prisma.signatureVersion.count({
      where: { signatureId: input.signatureId },
    });
    const row = await this.prisma.signatureVersion.create({
      data: {
        signatureId: input.signatureId,
        versionNumber: count + 1,
        htmlContent: input.htmlContent,
        plainTextContent: input.plainTextContent,
        createdBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<SignatureVersion | null> {
    const row = await this.prisma.signatureVersion.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findBySignature(signatureId: string): Promise<SignatureVersion[]> {
    const rows = await this.prisma.signatureVersion.findMany({
      where: { signatureId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map(toDomain);
  }
}
