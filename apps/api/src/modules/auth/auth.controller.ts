import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from '../../application/auth/auth.service';
import { AuthenticatedUser, LoginResult } from '../../application/auth/auth.types';
import { AllowPendingPasswordChange } from './decorators/allow-pending-password-change.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): { status: 'ok' } {
    // Stateless JWT: there is nothing to invalidate server-side yet. The
    // client is expected to discard the token. A revocation list / short
    // token TTL + refresh is listed as follow-up work, not silently
    // skipped — see README > "Limitaciones".
    return { status: 'ok' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @AllowPendingPasswordChange()
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @AllowPendingPasswordChange()
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ status: 'ok' }> {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { status: 'ok' };
  }
}
