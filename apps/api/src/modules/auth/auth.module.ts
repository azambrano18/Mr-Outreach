import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from '../../application/auth/auth.service';
import { AuthorizationService } from '../../application/auth/authorization.service';
import { AppConfigModule } from '../../infrastructure/config/app-config.module';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthController } from './auth.controller';
import { PermissionsGuard } from './guards/permissions.guard';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    AppConfigModule,
    PersistenceModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.authSecret,
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthorizationService, JwtStrategy, PermissionsGuard],
  exports: [AuthService, AuthorizationService, PermissionsGuard],
})
export class AuthModule {}
