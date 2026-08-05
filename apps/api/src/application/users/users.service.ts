import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { isProtectedSystemAccount } from '../../domain/user/protected-system-account';
import { Role } from '../../domain/role/role.entity';
import { RoleRepository } from '../../domain/role/role.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { fullName, UpdateUserInput, User, UserStatus } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
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
  DeletionImpact,
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
  'PAUSE_REQUESTED',
  'PAUSED',
  'RESUME_REQUESTED',
  'STOP_REQUESTED',
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
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY) private readonly clientExecutiveAssignments: ClientExecutiveAssignmentRepository,
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
   *
   * Restore-on-create: `(organizationId, email)` is a hard database unique
   * constraint that does NOT account for `deletedAt` (a soft-deleted row
   * still occupies that slot), so attempting to INSERT a new user reusing
   * a deleted user's email would hit that constraint and crash as an
   * unhandled 500 — this is checked explicitly, up front, precisely to
   * avoid ever reaching that INSERT. `findByEmailIncludingDeleted` (unlike
   * every other lookup in this service) is the one place allowed to see a
   * soft-deleted row, exactly so this branch can tell "no user ever had
   * this email" apart from "one did, and was deleted."
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

    const existingByEmail = await this.users.findByEmailIncludingDeleted(organizationId, input.email);
    if (existingByEmail) {
      if (existingByEmail.deletedAt !== null) {
        // Structurally unreachable in practice today — remove() already
        // unconditionally refuses to delete the protected system account,
        // so it can never actually end up soft-deleted — but kept as an
        // explicit, defense-in-depth guard on the restore path itself
        // ("mantener todas sus protecciones") rather than relying solely
        // on that other method never having a bug.
        if (isProtectedSystemAccount(existingByEmail.email)) {
          throw new ForbiddenException('No es posible restaurar la cuenta protegida del sistema.');
        }
        return this.restore(organizationId, existingByEmail, role, actorId);
      }
      if (existingByEmail.status === 'ACTIVE') {
        throw new ConflictException('Ya existe un usuario activo con este correo en esta organización.');
      }
      throw new ConflictException(
        'Ya existe un usuario inactivo con este correo. Actívalo desde su perfil en lugar de crear uno nuevo.',
      );
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
    return { ...summary, temporaryPassword, restored: false };
  }

  /**
   * DELETED -> ACTIVE, reusing the same userId. Deliberately narrow: only
   * identity/access fields are touched (name, role, credentials, status).
   * No operational data is restored — mailbox assignments and client
   * grants are structurally impossible to have survived deletion for
   * mailboxes (remove() blocks deletion while still PRIMARY anywhere, and
   * strips SECONDARY as part of deleting), but ClientExecutiveAssignment
   * rows are NOT cleaned up by remove() today, so they're cleared here
   * explicitly — the one piece of "old operational data" that could
   * otherwise silently reappear as soon as this account is ACTIVE again.
   * Conversations/Plantillas/Gestiones/notifications were never owned by
   * the user row itself and need no cleanup here.
   */
  private async restore(
    organizationId: string,
    existing: User,
    role: Role,
    actorId: string,
  ): Promise<CreateUserResult> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, PASSWORD_HASH_ROUNDS);

    const restored = await this.users.update(existing.id, {
      // Name/email are deliberately left untouched — restore only ever
      // reinstates the identity/access fields listed above; it never
      // overwrites the historical record with whatever was just typed
      // into the "Crear usuario" form.
      passwordHash,
      status: 'ACTIVE',
      mustChangePassword: true,
      // Same convention resetPassword() already uses for "must personally
      // set a real password" — never trust the caller's stale value.
      passwordChangedAt: null,
      deletedAt: null,
    });

    const previousRoles = await this.userRoles.getRolesForUser(existing.id);
    await Promise.all(previousRoles.map((previousRole) => this.userRoles.unassign(existing.id, previousRole.id)));
    await this.userRoles.assign(existing.id, role.id);

    const staleClientAssignments = await this.clientExecutiveAssignments.findByUser(existing.id);
    await Promise.all(
      staleClientAssignments.map((assignment) =>
        this.clientExecutiveAssignments.remove(assignment.clientId, existing.id),
      ),
    );

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'user.restored',
      entityType: 'User',
      entityId: existing.id,
      metadata: {
        email: existing.email,
        roleName: role.name,
        previouslyDeletedAt: existing.deletedAt,
        clientAssignmentsCleared: staleClientAssignments.length,
      },
    });

    const summary = await this.toSummary(restored);
    return { ...summary, temporaryPassword, restored: true };
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

  /**
   * Unconditional protections for `sistema@mejoreferido.cl` — checked
   * before any write this method could make, never bypassable via
   * permissions or payload shape:
   *   - its email can never change (renaming it away from the recognized
   *     identity would silently disable every other protection below on
   *     the very next call, since matching is by email, never by id — see
   *     protected-system-account.ts);
   *   - it can never lose the ADMIN role through a role reassignment.
   * Both are independent of, and in addition to, the deactivate/delete
   * blocks in `setStatus`/`remove` below.
   */
  async update(
    organizationId: string,
    userId: string,
    input: UpdateExecutiveInput,
    actorId: string,
  ): Promise<UserSummary> {
    const existing = await this.getOwnedUser(organizationId, userId);
    const protectedAccount = isProtectedSystemAccount(existing.email);

    if (
      protectedAccount &&
      input.email !== undefined &&
      input.email.trim().toLowerCase() !== existing.email.trim().toLowerCase()
    ) {
      throw new ForbiddenException('No es posible cambiar el correo de la cuenta protegida del sistema.');
    }

    if (input.roleId) {
      const role = await this.requireOwnedRole(organizationId, input.roleId);
      if (protectedAccount && role.name !== ADMIN_ROLE_NAME) {
        throw new ForbiddenException('La cuenta protegida del sistema debe mantener el rol de administrador.');
      }
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

    // Unconditional — the protected root account can never be deactivated,
    // regardless of the caller's permissions or how the request was made
    // (UI, direct API call, crafted payload). Reactivating it (status ===
    // 'ACTIVE') is never blocked: it's a no-op at worst and never leaves
    // the account without access.
    if (status === 'INACTIVE' && isProtectedSystemAccount(existing.email)) {
      throw new ForbiddenException('La cuenta principal del sistema no puede desactivarse ni eliminarse.');
    }

    // Mirrors the same invariant `remove()` protects (never leave the
    // organization without an active admin) — moved here too because
    // `remove()` now requires a user be INACTIVE before it can be deleted,
    // which means deactivation, not deletion, is the actual point where an
    // admin could otherwise be reduced to zero.
    if (status === 'INACTIVE' && existing.status === 'ACTIVE') {
      const [role] = await this.userRoles.getRolesForUser(existing.id);
      if (role?.name === ADMIN_ROLE_NAME) {
        const otherActiveAdmins = await this.countOtherActiveAdmins(organizationId, existing.id);
        if (otherActiveAdmins === 0) {
          throw new ConflictException('No es posible desactivar al último administrador activo de la organización.');
        }
      }
    }

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
   * Soft-deletes a user — ADMIN or EXECUTIVE, both go through this same
   * method now. Every read path (`findById`, `findAll`, `findByEmail`,
   * `findByEmailAnyOrganization`) already filters `deletedAt: null`, so
   * once this commits the user instantly: disappears from every listing
   * and selector, can no longer log in (login resolves via
   * `findByEmailAnyOrganization`), and has any existing session
   * invalidated on its very next request (`getAuthenticatedUser` resolves
   * via `findById`). `status` is also set to INACTIVE as a second,
   * redundant signal — but `deletedAt` is the actual source of truth that
   * distinguishes "eliminado" from a merely deactivated (status=INACTIVE,
   * deletedAt=null) user.
   *
   * Unconditional blocks, checked before anything else and never
   * bypassable by any caller regardless of permissions:
   *   - the protected root account (`sistema@mejoreferido.cl`, matched by
   *     email — see protected-system-account.ts — never by id, which
   *     varies per environment);
   *   - deleting one's own account (an admin must never lock themselves
   *     out mid-session).
   *
   * Resolvable blocks (ConflictException — the caller can fix the
   * condition and retry):
   *   - the user is still ACTIVE — the flow is always ACTIVE -> INACTIVE ->
   *     DELETED, never ACTIVE -> DELETED directly; deactivate first (see
   *     `setStatus`, which is also where the "never leave the organization
   *     without an active admin" rule is enforced now — once a user must
   *     already be INACTIVE to reach this method, re-checking that rule
   *     here would be checking a condition (`status === 'ACTIVE'`) that can
   *     no longer be true);
   *   - still the PRIMARY assignee on any mailbox — a mailbox can never be
   *     left without a primary;
   *   - owns a non-terminal (draft or still-running) Gestión.
   * A SECONDARY assignment is not blocking: it's removed automatically as
   * part of the deletion, since losing a secondary never leaves a mailbox
   * in an invalid state.
   */
  async remove(organizationId: string, userId: string, actorId: string, reason?: string): Promise<void> {
    const existing = await this.getOwnedUser(organizationId, userId);

    if (isProtectedSystemAccount(existing.email)) {
      throw new ForbiddenException('Esta cuenta está protegida por el sistema y no puede eliminarse.');
    }
    if (existing.id === actorId) {
      throw new ForbiddenException('No puedes eliminar tu propia cuenta mientras tienes una sesión activa.');
    }
    if (existing.status === 'ACTIVE') {
      throw new ConflictException('El usuario debe desactivarse antes de poder eliminarse.');
    }

    const [role] = await this.userRoles.getRolesForUser(existing.id);
    const roleName = role?.name ?? null;

    const impact = await this.computeDeletionImpact(organizationId, existing);
    if (impact.primaryMailboxCount > 0) {
      throw new ConflictException(
        `Este usuario es el principal de ${impact.primaryMailboxCount} cuenta(s) de correo. Reasigna esas cuentas antes de eliminarlo.`,
      );
    }
    if (impact.activeExecutionCount > 0) {
      throw new ConflictException(
        `Este usuario tiene ${impact.activeExecutionCount} gestión(es) sin finalizar. Deben completarse, fallar o reasignarse antes de eliminarlo.`,
      );
    }

    const secondaryAssignments = impact.assignments.filter((assignment) => assignment.role === 'SECONDARY');
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
        roleName: roleName ?? '—',
        secondaryAssignmentsRemoved: secondaryAssignments.length,
        ...(reason ? { reason } : {}),
      },
    });
  }

  /**
   * Read-only preview for the "Eliminar usuario" confirmation modal — shows
   * the same counts and blockers `remove()` would enforce, computed the
   * same way, so the modal never invents or estimates a number. Purely
   * informational: `remove()` re-derives and re-checks every one of these
   * independently and is the only method that can ever actually enforce
   * them.
   */
  async getDeletionImpact(organizationId: string, userId: string, actorId: string): Promise<DeletionImpact> {
    const existing = await this.getOwnedUser(organizationId, userId);
    const [role] = await this.userRoles.getRolesForUser(existing.id);
    const roleName = role?.name ?? null;
    const protectedAccount = isProtectedSystemAccount(existing.email);
    const isSelf = existing.id === actorId;
    const mustDeactivateFirst = existing.status === 'ACTIVE';

    let isLastActiveAdmin = false;
    if (roleName === ADMIN_ROLE_NAME && existing.status === 'ACTIVE') {
      isLastActiveAdmin = (await this.countOtherActiveAdmins(organizationId, existing.id)) === 0;
    }

    const impact = await this.computeDeletionImpact(organizationId, existing);
    const canDelete =
      !protectedAccount &&
      !isSelf &&
      !mustDeactivateFirst &&
      !isLastActiveAdmin &&
      impact.primaryMailboxCount === 0 &&
      impact.activeExecutionCount === 0;

    return {
      roleName: roleName ?? '—',
      isProtectedSystemAccount: protectedAccount,
      isSelf,
      mustDeactivateFirst,
      isLastActiveAdmin,
      primaryMailboxCount: impact.primaryMailboxCount,
      secondaryMailboxCount: impact.secondaryMailboxCount,
      activeExecutionCount: impact.activeExecutionCount,
      canDelete,
    };
  }

  private async computeDeletionImpact(
    organizationId: string,
    user: User,
  ): Promise<{
    assignments: MailboxAssignment[];
    primaryMailboxCount: number;
    secondaryMailboxCount: number;
    activeExecutionCount: number;
  }> {
    const assignments = await this.mailboxAssignments.findByUser(user.id);
    const primaryMailboxCount = assignments.filter((assignment) => assignment.role === 'PRIMARY').length;
    const secondaryMailboxCount = assignments.filter((assignment) => assignment.role === 'SECONDARY').length;

    const executions = await this.sequenceExecutions.findByExecutive(organizationId, user.id);
    const activeExecutionCount = executions.filter((execution) =>
      NON_TERMINAL_EXECUTION_STATUSES.includes(execution.status),
    ).length;

    return { assignments, primaryMailboxCount, secondaryMailboxCount, activeExecutionCount };
  }

  /** Active (status=ACTIVE, not soft-deleted) admins in the organization, excluding `excludingUserId`. */
  private async countOtherActiveAdmins(organizationId: string, excludingUserId: string): Promise<number> {
    const allUsers = await this.users.findAll(organizationId);
    const candidates = allUsers.filter((user) => user.status === 'ACTIVE' && user.id !== excludingUserId);
    const isAdminFlags = await Promise.all(
      candidates.map(async (user) => {
        const [role] = await this.userRoles.getRolesForUser(user.id);
        return role?.name === ADMIN_ROLE_NAME;
      }),
    );
    return isAdminFlags.filter(Boolean).length;
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
