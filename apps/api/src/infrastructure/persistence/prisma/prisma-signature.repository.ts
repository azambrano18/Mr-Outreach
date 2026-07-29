import { Injectable } from '@nestjs/common';
import { Signature as PrismaSignatureRow } from '@prisma/client';
import {
  CreateSignatureInput,
  Signature,
  UpdateSignatureInput,
} from '../../../domain/signature/signature.entity';
import { SignatureRepository } from '../../../domain/signature/signature.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

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

  async findByMailbox(mailboxId: string, ctx?: TransactionContext): Promise<Signature | null> {
    const row = await resolveClient(this.prisma, ctx).signature.findUnique({ where: { mailboxId } });
    return row ? toDomain(row) : null;
  }

  async findAllByOrganization(organizationId: string): Promise<Signature[]> {
    const rows = await this.prisma.signature.findMany({ where: { organizationId } });
    return rows.map(toDomain);
  }

  async create(input: CreateSignatureInput, ctx?: TransactionContext): Promise<Signature> {
    const row = await resolveClient(this.prisma, ctx).signature.create({
      data: { organizationId: input.organizationId, mailboxId: input.mailboxId },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSignatureInput, ctx?: TransactionContext): Promise<Signature> {
    const row = await resolveClient(this.prisma, ctx).signature.update({
      where: { id },
      data: { status: input.status, activeVersionId: input.activeVersionId },
    });
    return toDomain(row);
  }
}
