import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../../../application/auth/auth.types';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY } from '../decorators/allow-pending-password-change.decorator';
import { PERMISSIONS_METADATA_KEY } from '../decorators/require-permissions.decorator';

interface RequestWithUser {
  user?: AuthenticatedUser;
}

/**
 * Must run after JwtAuthGuard (which populates req.user). Reads the
 * permission keys declared via @RequirePermissions and denies the request
 * unless the authenticated user holds every one of them — a policy check,
 * never a hardcoded `user.role === 'ADMIN'`.
 *
 * Also the single enforcement point for "must change password": guards
 * aren't registered globally in this app (every controller repeats
 * @UseGuards(JwtAuthGuard, PermissionsGuard)), so this is the one place
 * that already runs on every protected route. This is defense-in-depth —
 * the frontend's own redirect (dashboard layout) is the primary UX gate —
 * but it stops any direct API call from doing anything else while a
 * password change is pending.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const allowsPendingPasswordChange = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (request.user?.mustChangePassword && !allowsPendingPasswordChange) {
      throw new ForbiddenException('Password change required before continuing.');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const userPermissions = new Set(request.user?.permissions ?? []);
    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissions.has(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
