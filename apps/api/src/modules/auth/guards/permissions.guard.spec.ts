import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function buildContext(permissions: string[] | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: permissions ? { permissions } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function buildContextWithPendingPasswordChange(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { permissions: ['users.read'], mustChangePassword: true } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows the request when the route declares no required permissions', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('allows the request when the user holds every required permission', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['users.read', 'users.update']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(buildContext(['users.read', 'users.update', 'audit.read']))).toBe(
      true,
    );
  });

  it('denies the request when the user is missing at least one required permission', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['users.read', 'users.disable']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(buildContext(['users.read']))).toThrow(ForbiddenException);
  });

  it('denies an unauthenticated request against a permission-gated route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['users.read']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
  });

  it('blocks a user with a pending password change from any route not marked @AllowPendingPasswordChange', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(buildContextWithPendingPasswordChange())).toThrow(
      ForbiddenException,
    );
  });

  it('lets a user with a pending password change through a route marked @AllowPendingPasswordChange', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(true) // ALLOW_PENDING_PASSWORD_CHANGE_KEY lookup
        .mockReturnValueOnce(undefined), // PERMISSIONS_METADATA_KEY lookup — no permissions required
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(guard.canActivate(buildContextWithPendingPasswordChange())).toBe(true);
  });
});
