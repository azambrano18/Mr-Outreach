import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

/**
 * Reversible encryption for IMAP/SMTP passwords — deliberately NOT
 * hashing, because the engine needs the real secret back to open a
 * connection (see README > "Cifrado de credenciales"). This is a local
 * AES-256-GCM implementation keyed by CREDENTIALS_ENCRYPTION_KEY; the
 * architecture notes for the full platform call for envelope encryption
 * behind an external KMS in production — this is the right shape for
 * that upgrade (encrypt/decrypt behind one service, one call site) but
 * the key itself is only as safe as this process's environment today.
 */
@Injectable()
export class SecretEncryptionService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.credentialsEncryptionKey, 'base64');
    if (this.key.length !== 32) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
      '.',
    );
  }

  decrypt(payload: string): string {
    const [ivB64, authTagB64, ciphertextB64] = payload.split('.');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Malformed encrypted payload.');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
