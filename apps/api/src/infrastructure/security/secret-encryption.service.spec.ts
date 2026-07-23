import { AppConfigService } from '../config/app-config.service';
import { SecretEncryptionService } from './secret-encryption.service';

function buildConfig(key: string): AppConfigService {
  return { credentialsEncryptionKey: key } as unknown as AppConfigService;
}

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

describe('SecretEncryptionService', () => {
  it('round-trips a plaintext value through encrypt/decrypt', () => {
    const service = new SecretEncryptionService(buildConfig(VALID_KEY));

    const ciphertext = service.encrypt('super-secret-imap-password');

    expect(ciphertext).not.toContain('super-secret-imap-password');
    expect(service.decrypt(ciphertext)).toBe('super-secret-imap-password');
  });

  it('never produces the same ciphertext twice for the same plaintext (random IV)', () => {
    const service = new SecretEncryptionService(buildConfig(VALID_KEY));

    const first = service.encrypt('same-password');
    const second = service.encrypt('same-password');

    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe('same-password');
    expect(service.decrypt(second)).toBe('same-password');
  });

  it('rejects a tampered ciphertext instead of silently returning garbage', () => {
    const service = new SecretEncryptionService(buildConfig(VALID_KEY));
    const ciphertext = service.encrypt('a-password');
    const [iv, authTag, body] = ciphertext.split('.');
    const tampered = [iv, authTag, `${body.slice(0, -2)}zz`].join('.');

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('refuses to construct with a key that is not exactly 32 bytes', () => {
    const shortKey = Buffer.alloc(16).toString('base64');
    expect(() => new SecretEncryptionService(buildConfig(shortKey))).toThrow(/32 bytes/);
  });
});
