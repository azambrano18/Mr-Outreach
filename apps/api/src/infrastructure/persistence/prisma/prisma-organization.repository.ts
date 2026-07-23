import { Injectable } from '@nestjs/common';
import {
  CreateOrganizationInput,
  Organization,
} from '../../../domain/organization/organization.entity';
import { OrganizationRepository } from '../../../domain/organization/organization.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    return this.prisma.organization.create({ data: { name: input.name } });
  }
}
