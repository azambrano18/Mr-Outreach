import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { HtmlSanitizerService } from './html-sanitizer.service';
import { SecretEncryptionService } from './secret-encryption.service';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [SecretEncryptionService, HtmlSanitizerService],
  exports: [SecretEncryptionService, HtmlSanitizerService],
})
export class SecurityModule {}
