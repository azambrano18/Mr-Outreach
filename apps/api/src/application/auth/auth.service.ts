import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { fullName, User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { AUDIT_LOG_REPOSITORY, USER_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { meetsPasswordPolicy } from '../users/temporary-password.generator';
import { AuthenticatedUser, LoginResult } from './auth.types';
import { AuthorizationService } from './authorization.service';

// A valid bcrypt hash whose plaintext is unknown/unrecoverable. Comparing
// against it when no user is found keeps failed-login timing similar to a
// real password check, instead of returning early and leaking (via
// response time) whether an email exists.
const DUMMY_PASSWORD_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8lXfaXcaqtsIsMH2Yzx1YOAtJs.5wq';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly authorization: AuthorizationService,
    private readonly jwtService: JwtService,
  ) {}

  async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmailAnyOrganization(email);
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || user.status !== 'ACTIVE' || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return user;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.validateCredentials(email, password);
    const authenticatedUser = await this.toAuthenticatedUser(user);

    const accessToken = await this.jwtService.signAsync({ sub: user.id });

    await this.users.update(user.id, { lastLoginAt: new Date() });

    await this.auditLogs.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
    });

    return { accessToken, user: authenticatedUser };
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid session.');
    }
    return this.toAuthenticatedUser(user);
  }

  /**
   * Re-verifies the current (often still-temporary) password before
   * accepting a new one — never a shortcut, even for a forced change.
   * Never puts either password in audit metadata.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid session.');
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    if (!meetsPasswordPolicy(newPassword)) {
      throw new BadRequestException(
        'The new password must be at least 10 characters and include upper case, lower case and a digit.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.users.update(user.id, {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    });

    await this.auditLogs.record({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'auth.change_password',
      entityType: 'User',
      entityId: user.id,
    });
  }

  private async toAuthenticatedUser(user: User): Promise<AuthenticatedUser> {
    const permissions = await this.authorization.getPermissionKeysForUser(user.id);
    return {
      id: user.id,
      organizationId: user.organizationId,
      name: fullName(user),
      email: user.email,
      permissions,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
