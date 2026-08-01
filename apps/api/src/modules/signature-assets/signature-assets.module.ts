import { Module } from '@nestjs/common';
import { SignatureAssetsService } from '../../application/signature-assets/signature-assets.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SignatureAssetStorageModule } from '../../infrastructure/signature-asset-storage/signature-asset-storage.module';
import { AuthModule } from '../auth/auth.module';
import { MeSignatureAssetsController, SignatureAssetsController } from './signature-assets.controller';

@Module({
  imports: [PersistenceModule, SignatureAssetStorageModule, AuthModule],
  controllers: [SignatureAssetsController, MeSignatureAssetsController],
  providers: [SignatureAssetsService],
  exports: [SignatureAssetsService],
})
export class SignatureAssetsModule {}
