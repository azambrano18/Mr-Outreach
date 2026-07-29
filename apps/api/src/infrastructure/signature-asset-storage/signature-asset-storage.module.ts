import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { R2SignatureAssetStorageAdapter } from './r2/r2-signature-asset-storage-adapter';
import { SimulatedSignatureAssetStorageAdapter } from './simulated/simulated-signature-asset-storage-adapter';
import { SIGNATURE_ASSET_STORAGE_PORT } from './tokens';

@Module({
  imports: [AppConfigModule],
  providers: [
    SimulatedSignatureAssetStorageAdapter,
    R2SignatureAssetStorageAdapter,
    {
      provide: SIGNATURE_ASSET_STORAGE_PORT,
      useFactory: (
        config: AppConfigService,
        simulated: SimulatedSignatureAssetStorageAdapter,
        r2: R2SignatureAssetStorageAdapter,
      ) => (config.signatureAssetStorageMode === 'r2' ? r2 : simulated),
      inject: [AppConfigService, SimulatedSignatureAssetStorageAdapter, R2SignatureAssetStorageAdapter],
    },
  ],
  exports: [SIGNATURE_ASSET_STORAGE_PORT],
})
export class SignatureAssetStorageModule {}
