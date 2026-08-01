import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { RoleRepository } from '../../domain/role/role.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { fullName, UpdateUserInput, User, UserStatus } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  ROLE_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  USER_REPOSITORY,
  USER_ROLE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME } from '../../modules/seed/system-roles';
import { generateTemporaryPassword } from './temporary-password.generator';
import {
  CreateExecutiveInput,
  CreateUserResult,
  ResetPasswordResult,
  UpdateExecutiveInput,
  UserSummary,
} from './users.types';

const PASSWORD_HASH_ROUNDS = 10;
const CREATABLE_ROLE_NAMES = [ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME];
const NON_TERMINAL_EXECUTION_STATUSES: SequenceExecutionStatus[] = [
  'DRAFT',
  'VALIDATING',
  'SUBMITTING',
  'SUBMISSION_UNKNOWN',
  'ACCEPTED',
  'RUNNING',
];

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(USER_ROLE_REPOSITORY) private readonly userRoles: UserRoleRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly sequenceExecutions: SequenceExecutionRepository,
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
   * This endpoint only ever creates ADMIN or EXECUTIVE users — it backs
   * the "Crear usuario" screen exclusively, never a general-purpose
   * "assign any role" API. The client submits a roleId, but that is never
   * trusted at face value: it must resolve to a role that belongs to this
   * organization AND is literally named ADMIN or EXECUTIVE, or the
   * request is rejected. This is what stops a crafted request (or a
   * compromised/buggy frontend) from assigning a custom or otherwise
   * unintended role through this form. Only a caller holding
   * `users.create` (ADMIN only, per the permission catalog) can reach
   * this method at all, so an EXECUTIVE can never create any user.
   */
  async create(
    organizationId: string,
    input: CreateExecutiveInput,
    actorId: string,
  ): Promise<CreateUserResult> {
    const role = await this.requireOwnedRole(organizationId, input.roleId);
    if (!CREATABLE_ROLE_NAMES.includes(role.name)) {
      throw new BadRequestException(`Only the ${CREATABLE_ROLE_NAMES.join(' or ')} role can be assigned through this endpoint.`);
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
   * Soft-deletes an EXECUTIVE — never an ADMIN through this method. Every
   * read path (`findById`, `findAll`, `findByEmail`, `findByEmailAnyOrganization`)
   * already filters `deletedAt: null`, so once this commits the user
   * instantly: disappears from every listing and selector, can no longer
   * log in (login resolves via `findByEmailAnyOrganization`), and has any
   * existing session invalidated on its very next request (`getAuthenticatedUser`
   * resolves via `findById`). `status` is also set to INACTIVE as a second,
   * redundant signal — but `deletedAt` is the actual source of truth that
   * distinguishes "eliminado" from a merely deactivated (status=INACTIVE,
   * deletedAt=null) user.
   *
   * Blocks deletion (ConflictException, never silently ignored) if the
   * executive is still the PRIMARY assignee on any mailbox — those must be
   * reassigned first, since a mailbox can never be left without a primary.
   * Also blocks if they own any non-terminal (draft or still-running)
   * Gestión — those must finish, fail, or get reassigned first. A
   * SECONDARY assignment is not blocking: it's removed automatically as
   * part of the deletion, since losing a secondary never leaves a mailbox
   * in an invalid state.
   */
  async remove(organizationId: string, userId: string, actorId: string): Promise<void> {
    const existing = await this.getOwnedUser(organizationId, userId);
    const [role] = await this.userRoles.getRolesForUser(existing.id);
    if (!role || role.name !== EXECUTIVE_ROLE_NAME) {
      throw new ConflictException('Solo se pueden eliminar usuarios con rol Ejecutivo.');
    }

    const assignments = await this.mailboxAssignments.findByUser(existing.id);
    const primaryAssignments = assignments.filter((assignment) => assignment.role === 'PRIMARY');
    if (primaryAssignments.length > 0) {
      throw new ConflictException(
        `Este ejecutivo es el principal de ${primaryAssignments.length} cuenta(s) de correo. Reasigna esas cuentas antes de eliminarlo.`,
      );
    }

    const executions = await this.sequenceExecutions.findByExecutive(organizationId, existing.id);
    const activeExecutions = executions.filter((execution) =>
      NON_TERMINAL_EXECUTION_STATUSES.includes(execution.status),
    );
    if (activeExecutions.length > 0) {
      throw new ConflictException(
        `Este ejecutivo tiene ${activeExecutions.length} gestión(es) sin finalizar. Deben completarse, fallar o reasignarse antes de eliminarlo.`,
      );
    }

    const secondaryAssignments = assignments.filter((assignment) => assignment.role === 'SECONDARY');
    for (const assignment of secondaryAssignments) {
      await this.mailboxAssignments.remove(assignment.mailboxId, existing.id);
    }

    await this.users.update(existing.id, { status: 'INACTIVE', deletedAt: new Date() });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'user.delete',
      entityType: 'User',
      entityId: userId,
      metadata: {
        email: existing.email,
        roleName: role.name,
        secondaryAssignmentsRemoved: secondaryAssignments.length,
      },
    });
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
