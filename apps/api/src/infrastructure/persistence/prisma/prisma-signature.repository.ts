import { Injectable } from '@nestjs/common';
import { Signature as PrismaSignatureRow } from '@prisma/client';
import {
  CreateSignatureInput,
  Signature,
  UpdateSignatureInput,
} from '../../../domain/signature/signature.entity';
import { SignatureRepository } from '../../../domain/signature/signature.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSignatureRow): Signature {
  return {
    id: row.id,
    organizationId: row.organizationId,
    mailboxId: row.mailboxId,
    status: row.status,
    activeVersionId: row.activeVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaSignatureRepository implements SignatureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Signature | null> {
    const row = await this.prisma.signature.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByMailbox(mailboxId: string): Promise<Signature | null> {
    const row = await this.prisma.signature.findUnique({ where: { mailboxId } });
    return row ? toDomain(row) : null;
  }

  async findAllByOrganization(organizationId: string): Promise<Signature[]> {
    const rows = await this.prisma.signature.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async create(input: CreateSignatureInput): Promise<Signature> {
    const row = await this.prisma.signature.create({
      data: { organizationId: input.organizationId, mailboxId: input.mailboxId },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSignatureInput): Promise<Signature> {
    const row = await this.prisma.signature.update({
      where: { id },
      data: { status: input.status, activeVersionId: input.activeVersionId },
    });
    return toDomain(row);
  }
}
