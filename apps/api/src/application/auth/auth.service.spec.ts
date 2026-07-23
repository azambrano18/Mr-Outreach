import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { fullName, User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { AuthService } from './auth.service';
import { AuthorizationService } from './authorization.service';

describe('AuthService', () => {
  let users: jest.Mocked<UserRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let authorization: jest.Mocked<AuthorizationService>;
  let jwtService: jest.Mocked<JwtService>;
  let service: AuthService;

  const activeUser: User = {
    id: 'user_1',
    organizationId: 'org_1',
    firstName: 'Administrador',
    lastName: '',
    email: 'admin@local.test',
    passwordHash: bcrypt.hashSync('correct-password', 4),
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailAnyOrganization: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    authorization = {
      getPermissionKeysForUser: jest.fn().mockResolvedValue(['users.read']),
    } as never;
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') } as never;

    service = new AuthService(users, auditLogs, authorization, jwtService);
  });

  describe('validateCredentials', () => {
    it('returns the user when the email exists and the password matches', async () => {
      users.findByEmailAnyOrganization.mockResolvedValue(activeUser);

      const result = await service.validateCredentials('admin@local.test', 'correct-password');

      expect(result).toBe(activeUser);
    });

    it('rejects an unknown email with a generic error', async () => {
      users.findByEmailAnyOrganization.mockResolvedValue(null);

      await expect(service.validateCredentials('nobody@local.test', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password with a generic error', async () => {
      users.findByEmailAnyOrganization.mockResolvedValue(activeUser);

      await expect(
        service.validateCredentials('admin@local.test', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a deactivated user even with the correct password', async () => {
      users.findByEmailAnyOrganization.mockResolvedValue({ ...activeUser, status: 'INACTIVE' });

      await expect(
        service.validateCredentials('admin@local.test', 'correct-password'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('issues a token, resolves permissions, and records an audit entry', async () => {
      users.findByEmailAnyOrganization.mockResolvedValue(activeUser);

      const result = await service.login('admin@local.test', 'correct-password');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toEqual({
        id: activeUser.id,
        organizationId: activeUser.organizationId,
        name: fullName(activeUser),
        email: activeUser.email,
        permissions: ['users.read'],
        mustChangePassword: false,
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: activeUser.id });
      expect(users.update).toHaveBeenCalledWith(activeUser.id, { lastLoginAt: expect.any(Date) });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login', actorId: activeUser.id }),
      );
    });

    it('never calls the audit log or issues a token for invalid credentials', async () => {
      users.findByEmailAnyOrganization.mockResolvedValue(null);

      await expect(service.login('nobody@local.test', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(auditLogs.record).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('getAuthenticatedUser', () => {
    it('returns the current permissions for an active user', async () => {
      users.findById.mockResolvedValue(activeUser);

      const result = await service.getAuthenticatedUser('user_1');

      expect(result.permissions).toEqual(['users.read']);
    });

    it('rejects when the user was deactivated after the token was issued', async () => {
      users.findById.mockResolvedValue({ ...activeUser, status: 'INACTIVE' });

      await expect(service.getAuthenticatedUser('user_1')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password is wrong', async () => {
      users.findById.mockResolvedValue(activeUser);

      await expect(
        service.changePassword('user_1', 'wrong-current', 'NewStrongPass1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('rejects a new password that does not meet the policy', async () => {
      users.findById.mockResolvedValue(activeUser);

      await expect(service.changePassword('user_1', 'correct-password', 'weak')).rejects.toThrow();
      expect(users.update).not.toHaveBeenCalled();
    });

    it('hashes the new password, clears mustChangePassword, and audits — never logging either password', async () => {
      users.findById.mockResolvedValue(activeUser);
      users.update.mockResolvedValue({ ...activeUser, mustChangePassword: false });

      await service.changePassword('user_1', 'correct-password', 'NewStrongPass1');

      expect(users.update).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ mustChangePassword: false, passwordChangedAt: expect.any(Date) }),
      );
      const auditCall = auditLogs.record.mock.calls[0][0];
      expect(auditCall.action).toBe('auth.change_password');
      expect(JSON.stringify(auditCall)).not.toContain('correct-password');
      expect(JSON.stringify(auditCall)).not.toContain('NewStrongPass1');
    });
  });
});
