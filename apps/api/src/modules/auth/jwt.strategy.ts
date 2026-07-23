import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../../application/auth/auth.service';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { AppConfigService } from '../../infrastructure/config/app-config.service';

interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.authSecret,
    });
  }

  /**
   * Re-loads the user and recomputes permissions on every request instead
   * of trusting anything embedded in the token, so a disabled user or a
   * changed role/permission takes effect immediately.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return this.authService.getAuthenticatedUser(payload.sub);
  }
}
