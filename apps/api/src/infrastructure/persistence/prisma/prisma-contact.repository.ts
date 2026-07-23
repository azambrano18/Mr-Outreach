import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Contact as PrismaContactRow } from '@prisma/client';
import { Contact, CreateContactInput, UpdateContactInput } from '../../../domain/contact/contact.entity';
import { ContactRepository } from '../../../domain/contact/contact.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    companyId: row.companyId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: row.fullName,
    jobTitle: row.jobTitle,
    phone: row.phone,
    city: row.city,
    country: row.country,
    website: row.website,
    linkedin: row.linkedin,
    customFields: row.customFields as Record<string, string>,
    suppressed: row.suppressed,
    suppressedAt: row.suppressedAt,
    suppressedReason: row.suppressedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Contact | null> {
    const row = await this.prisma.contact.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(organizationId: string, clientId: string, email: string): Promise<Contact | null> {
    const row = await this.prisma.contact.findFirst({
      where: { organizationId, clientId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findByClient(organizationId: string, clientId: string): Promise<Contact[]> {
    const rows = await this.prisma.contact.findMany({ where: { organizationId, clientId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(input: CreateContactInput): Promise<Contact> {
    try {
      const row = await this.prisma.contact.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          companyId: input.companyId,
          email: input.email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          fullName: input.fullName ?? null,
          jobTitle: input.jobTitle ?? null,
          phone: input.phone ?? null,
          city: input.city ?? null,
          country: input.country ?? null,
          website: input.website ?? null,
          linkedin: input.linkedin ?? null,
          customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A contact with this email already exists for this client.');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateContactInput): Promise<Contact> {
    const row = await this.prisma.contact.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
