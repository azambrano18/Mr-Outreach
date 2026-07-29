import { Module } from '@nestjs/common';
import { SignaturesService } from '../../application/signatures/signatures.service';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { AuthModule } from '../auth/auth.module';
import { MeSignatureController } from './me-signature.controller';
import { SignaturesController } from './signatures.controller';

@Module({
  imports: [PersistenceModule, SecurityModule, EngineModule, AuthModule],
  controllers: [SignaturesController, MeSignatureController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
