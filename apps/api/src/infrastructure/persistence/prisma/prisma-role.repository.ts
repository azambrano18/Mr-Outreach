import { ConflictException, Injectable } from '@nestjs/common';
import { CreateRoleInput, Role } from '../../../domain/role/role.entity';
import { RoleRepository } from '../../../domain/role/role.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { id } });
  }

  async findByName(organizationId: string, name: string): Promise<Role | null> {
    return this.prisma.role.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
  }

  async findAll(organizationId: string): Promise<Role[]> {
    return this.prisma.role.findMany({ where: { organizationId } });
  }

  async create(input: CreateRoleInput): Promise<Role> {
    const existing = await this.findByName(input.organizationId, input.name);
    if (existing) {
      throw new ConflictException('A role with this name already exists in the organization.');
    }

    return this.prisma.role.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        rolePermissions: {
          create: input.permissionKeys.map((permissionKey) => ({ permissionKey })),
        },
      },
    });
  }

  async setPermissions(roleId: string, permissionKeys: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissionKeys.map((permissionKey) => ({ roleId, permissionKey })),
      }),
    ]);
  }

  async getPermissionKeys(roleId: string): Promise<string[]> {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permissionKey: true },
    });
    return rolePermissions.map((rp) => rp.permissionKey);
  }
}
