import { Injectable } from '@nestjs/common';
import { Permission } from '../../../domain/permission/permission.entity';
import { PermissionRepository } from '../../../domain/permission/permission.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaPermissionRepository implements PermissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Permission[]> {
    return this.prisma.permission.findMany();
  }

  async findByKey(key: string): Promise<Permission | null> {
    return this.prisma.permission.findUnique({ where: { key } });
  }

  async upsertMany(permissions: Permission[]): Promise<void> {
    for (const permission of permissions) {
      await this.prisma.permission.upsert({
        where: { key: permission.key },
        create: permission,
        update: { description: permission.description },
      });
    }
  }
}
