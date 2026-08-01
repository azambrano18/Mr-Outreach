import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { RoleRepository } from '../../domain/role/role.repository';
import { fullName, UpdateUserInput, User, UserStatus } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import {
  AUDIT_LOG_REPOSITORY,
  ROLE_REPOSITORY,
  USER_REPOSITORY,
  USER_ROLE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { EXECUTIVE_ROLE_NAME } from '../../modules/seed/system-roles';
import { generateTemporaryPassword } from './temporary-password.generator';
import {
  CreateExecutiveInput,
  CreateUserResult,
  ResetPasswordResult,
  UpdateExecutiveInput,
  UserSummary,
} from './users.types';

const PASSWORD_HASH_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(USER_ROLE_REPOSITORY) private readonly userRoles: UserRoleRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  async list(organizationId: string): Promise<UserSummary[]> {
    const users = await this.users.findAll(organizationId);
    return Promise.all(users.map((user) => this.toSummary(user)));
  }

  async getById(organizationId: string, userId: string): Promise<UserSummary> {
    const user = await this.getOwnedUser(organizationId, userId);
    return this.toSummary(user);
  }

  /**
   * The admin never chooses the password (per spec) — a temporary one is
   * always generated here and returned exactly once, in this response.
   * It is never logged, audited, or retrievable again afterward.
   *
   * This endpoint only ever creates EXECUTIVE users — it backs the
   * "Crear ejecutivo" screen exclusively, never a general-purpose
   * "create any user" API. The client is expected to submit the
   * organization's EXECUTIVE role id, but that is never trusted at face
   * value: it must resolve to a role that belongs to this organization
   * AND is literally named EXECUTIVE, or the request is rejected. This is
   * what stops a crafted request (or a compromised/buggy frontend) from
   * creating a second ADMIN through this form.
   */
  async create(
    organizationId: string,
    input: CreateExecutiveInput,
    actorId: string,
  ): Promise<CreateUserResult> {
    const role = await this.requireOwnedRole(organizationId, input.roleId);
    if (role.name !== EXECUTIVE_ROLE_NAME) {
      throw new BadRequestException(`Only the ${EXECUTIVE_ROLE_NAME} role can be assigned through this endpoint.`);
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, PASSWORD_HASH_ROUNDS);
    const user = await this.users.create({
      organizationId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash,
      mustChangePassword: true,
    });
    await this.userRoles.assign(user.id, role.id);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, roleName: role.name },
    });

    const summary = await this.toSummary(user);
    return { ...summary, temporaryPassword };
  }

  /**
   * Admin-triggered reset: generates a fresh temporary password (invalidating
   * the old one by overwriting its hash), forces mustChangePassword, and
   * returns the new password exactly once. Never accepts an admin-chosen value.
   */
  async resetPassword(
    organizationId: string,
    userId: string,
    actorId: string,
  ): Promise<ResetPasswordResult> {
    const existing = await this.getOwnedUser(organizationId, userId);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, PASSWORD_HASH_ROUNDS);
    const updated = await this.users.update(existing.id, {
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: null,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'user.reset_password',
      entityType: 'User',
      entityId: userId,
    });

    return { email: updated.email, temporaryPassword };
  }

  async update(
    organizationId: string,
    userId: string,
    input: UpdateExecutiveInput,
    actorId: string,
  ): Promise<UserSummary> {
    const existing = await this.getOwnedUser(organizationId, userId);

    if (input.roleId) {
      const role = await this.requireOwnedRole(organizationId, input.roleId);
      const currentRoles = await this.userRoles.getRolesForUser(userId);
      await Promise.all(currentRoles.map((role_) => this.userRoles.unassign(userId, role_.id)));
      await this.userRoles.assign(userId, role.id);
    }

    // Never spread `undefined` fields into the repository call: an
    // explicit `{ firstName: undefined }` would overwrite the existing value
    // in the in-memory adapter's `{ ...existing, ...input }` merge.
    const patch: UpdateUserInput = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.email !== undefined) patch.email = input.email;

    const updated = await this.users.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'user.update',
      entityType: 'User',
      entityId: userId,
    });

    return this.toSummary(updated);
  }

  async setStatus(
    organizationId: string,
    userId: string,
    status: UserStatus,
    actorId: string,
  ): Promise<UserSummary> {
    const existing = await this.getOwnedUser(organizationId, userId);

    const updated = await this.users.update(existing.id, { status });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: status === 'ACTIVE' ? 'user.activate' : 'user.deactivate',
      entityType: 'User',
      entityId: userId,
    });

    return this.toSummary(updated);
  }

  /**
   * Returns the user only if it belongs to the caller's organization.
   * Deliberately throws the same NotFoundException for "doesn't exist"
   * and "exists in a different organization" — a 403 would confirm the
   * id exists somewhere, a 404 does not.
   */
  private async getOwnedUser(organizationId: string, userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user || user.organizationId !== organizationId) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }

  private async requireOwnedRole(organizationId: string, roleId: string) {
    const role = await this.roles.findById(roleId);
    if (!role || role.organizationId !== organizationId) {
      throw new BadRequestException('Invalid role.');
    }
    return role;
  }

  private async toSummary(user: User): Promise<UserSummary> {
    const assignedRoles = await this.userRoles.getRolesForUser(user.id);
    const role = assignedRoles[0];

    return {
      id: user.id,
      organizationId: user.organizationId,
      name: fullName(user),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      status: user.status,
      roleId: role?.id ?? '',
      roleName: role?.name ?? '—',
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
