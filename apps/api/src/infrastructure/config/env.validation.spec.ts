import { envValidationSchema } from './env.validation';

const BASE_MEMORY_ENV = {
  PERSISTENCE_DRIVER: 'memory',
  ENGINE_DRIVER: 'mock',
  AUTH_SECRET: 'a-secret-that-is-long-enough',
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DEV_ADMIN_PASSWORD: 'dev-admin-password',
  DEV_EXECUTIVE_PASSWORD: 'dev-executive-password',
};

describe('envValidationSchema', () => {
  it('accepts memory + mock without DATABASE_URL or ENGINE_BASE_URL', () => {
    const { error } = envValidationSchema.validate(BASE_MEMORY_ENV, { abortEarly: false });
    expect(error).toBeUndefined();
  });

  it('starts up without DEV_ADMIN_EMAIL/DEV_EXECUTIVE_EMAIL set (defaults apply)', () => {
    const { error, value } = envValidationSchema.validate(BASE_MEMORY_ENV);
    expect(error).toBeUndefined();
    expect(value.DEV_ADMIN_EMAIL).toBe('admin@local.test');
    expect(value.DEV_EXECUTIVE_EMAIL).toBe('ejecutivo@local.test');
  });

  it('rejects memory mode missing DEV_ADMIN_PASSWORD (nothing to seed with)', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_MEMORY_ENV, DEV_ADMIN_PASSWORD: undefined },
      { abortEarly: false },
    );
    expect(error?.message).toMatch(/DEV_ADMIN_PASSWORD/);
  });

  it('rejects any mode missing AUTH_SECRET', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, AUTH_SECRET: undefined });
    expect(error?.message).toMatch(/AUTH_SECRET/);
  });

  it('requires DATABASE_URL when PERSISTENCE_DRIVER=postgres', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      PERSISTENCE_DRIVER: 'postgres',
      DEV_ADMIN_PASSWORD: undefined,
      DEV_EXECUTIVE_PASSWORD: undefined,
    });
    expect(error?.message).toMatch(/DATABASE_URL/);
  });

  it('does not require DEV_ADMIN_PASSWORD when PERSISTENCE_DRIVER=postgres', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      PERSISTENCE_DRIVER: 'postgres',
      DATABASE_URL: 'postgresql://user:pass@10.0.0.5:5432/outreach',
      DEV_ADMIN_PASSWORD: undefined,
      DEV_EXECUTIVE_PASSWORD: undefined,
    });
    expect(error).toBeUndefined();
  });

  it('requires a valid ENGINE_BASE_URL when ENGINE_DRIVER=http', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, ENGINE_DRIVER: 'http' });
    expect(error?.message).toMatch(/ENGINE_BASE_URL/);
  });

  it('accepts http engine driver once ENGINE_BASE_URL is a valid URI', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      ENGINE_DRIVER: 'http',
      ENGINE_BASE_URL: 'https://engine.internal',
    });
    expect(error).toBeUndefined();
  });

  it('accepts the default simulated MAILBOX_MOTOR_DRIVER without a MAILBOX_MOTOR_API_KEY', () => {
    const { error } = envValidationSchema.validate(BASE_MEMORY_ENV);
    expect(error).toBeUndefined();
  });

  it('requires MAILBOX_MOTOR_BASE_URL and MAILBOX_MOTOR_API_KEY when MAILBOX_MOTOR_DRIVER=http', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, MAILBOX_MOTOR_DRIVER: 'http' });
    expect(error?.message).toMatch(/MAILBOX_MOTOR_BASE_URL/);
  });

  it('accepts http mailbox motor driver once base URL and API key are set', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      MAILBOX_MOTOR_DRIVER: 'http',
      MAILBOX_MOTOR_BASE_URL: 'https://motor.internal',
      MAILBOX_MOTOR_API_KEY: 'a-real-key',
    });
    expect(error).toBeUndefined();
  });

  it('refuses to boot in production with MAILBOX_MOTOR_DRIVER=simulated — the simulator is a dev/staging-only tool', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      NODE_ENV: 'production',
      MAILBOX_MOTOR_DRIVER: 'simulated',
      MAILBOX_MOTOR_BASE_URL: 'https://motor.internal',
      MAILBOX_MOTOR_API_KEY: 'a-real-key',
    });
    expect(error?.message).toMatch(/MAILBOX_MOTOR_DRIVER/);
  });

  it('refuses to boot in production when MAILBOX_MOTOR_DRIVER is left unset — the default must never silently resolve to simulated', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      NODE_ENV: 'production',
      MAILBOX_MOTOR_BASE_URL: 'https://motor.internal',
      MAILBOX_MOTOR_API_KEY: 'a-real-key',
    });
    expect(error?.message).toMatch(/MAILBOX_MOTOR_DRIVER/);
  });

  it('accepts production with MAILBOX_MOTOR_DRIVER=http', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      NODE_ENV: 'production',
      MAILBOX_MOTOR_DRIVER: 'http',
      MAILBOX_MOTOR_BASE_URL: 'https://motor.internal',
      MAILBOX_MOTOR_API_KEY: 'a-real-key',
    });
    expect(error).toBeUndefined();
  });

  it('still allows MAILBOX_MOTOR_DRIVER=simulated in staging/development/test — only production is restricted', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, NODE_ENV: 'staging' });
    expect(error).toBeUndefined();
  });

  it('accepts the default simulated SEQUENCE_MOTOR_MODE without a SEQUENCE_MOTOR_API_KEY', () => {
    const { error, value } = envValidationSchema.validate(BASE_MEMORY_ENV);
    expect(error).toBeUndefined();
    expect(value.SEQUENCE_MOTOR_MODE).toBe('simulated');
  });

  it('rejects SEQUENCE_MOTOR_MODE=http missing both SEQUENCE_MOTOR_BASE_URL and SEQUENCE_MOTOR_API_KEY', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_MEMORY_ENV, SEQUENCE_MOTOR_MODE: 'http' },
      { abortEarly: false },
    );
    expect(error?.message).toMatch(/SEQUENCE_MOTOR_BASE_URL/);
    expect(error?.message).toMatch(/SEQUENCE_MOTOR_API_KEY/);
  });

  it('rejects SEQUENCE_MOTOR_MODE=http with a base URL but no API key', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      SEQUENCE_MOTOR_MODE: 'http',
      SEQUENCE_MOTOR_BASE_URL: 'https://sequence-motor.internal',
    });
    expect(error?.message).toMatch(/SEQUENCE_MOTOR_API_KEY/);
  });

  it('accepts http sequence motor mode once base URL and API key are both set', () => {
    const { error, value } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      SEQUENCE_MOTOR_MODE: 'http',
      SEQUENCE_MOTOR_BASE_URL: 'https://sequence-motor.internal',
      SEQUENCE_MOTOR_API_KEY: 'a-real-key',
    });
    expect(error).toBeUndefined();
    expect(value.SEQUENCE_MOTOR_TIMEOUT_MS).toBe(10_000);
  });

  it('rejects a non-numeric SEQUENCE_MOTOR_TIMEOUT_MS', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, SEQUENCE_MOTOR_TIMEOUT_MS: 'soon' });
    expect(error?.message).toMatch(/SEQUENCE_MOTOR_TIMEOUT_MS/);
  });

  it('Fase Firma — accepts the default simulated SIGNATURE_ASSET_STORAGE_MODE without any R2_* variable', () => {
    const { error, value } = envValidationSchema.validate(BASE_MEMORY_ENV);
    expect(error).toBeUndefined();
    expect(value.SIGNATURE_ASSET_STORAGE_MODE).toBe('simulated');
    expect(value.R2_PUBLIC_BASE_URL).toBe('https://assets.mejoreferido.com');
  });

  it('Fase Firma — rejects SIGNATURE_ASSET_STORAGE_MODE=r2 missing every R2_* variable', () => {
    const { error } = envValidationSchema.validate(
      { ...BASE_MEMORY_ENV, SIGNATURE_ASSET_STORAGE_MODE: 'r2' },
      { abortEarly: false },
    );
    expect(error?.message).toMatch(/R2_ACCOUNT_ID/);
    expect(error?.message).toMatch(/R2_ACCESS_KEY_ID/);
    expect(error?.message).toMatch(/R2_SECRET_ACCESS_KEY/);
    expect(error?.message).toMatch(/R2_BUCKET_NAME/);
  });

  it('Fase Firma — accepts SIGNATURE_ASSET_STORAGE_MODE=r2 once every R2_* variable (including a custom HTTPS public base URL) is set', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      SIGNATURE_ASSET_STORAGE_MODE: 'r2',
      R2_ACCOUNT_ID: 'acct_123',
      R2_ACCESS_KEY_ID: 'key_123',
      R2_SECRET_ACCESS_KEY: 'secret_123',
      R2_BUCKET_NAME: 'mr-outreach-assets',
      R2_PUBLIC_BASE_URL: 'https://assets.mejoreferido.com',
    });
    expect(error).toBeUndefined();
  });

  it('Fase Firma — rejects SIGNATURE_ASSET_STORAGE_MODE=r2 missing R2_PUBLIC_BASE_URL (the default is not trusted blindly in production)', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      SIGNATURE_ASSET_STORAGE_MODE: 'r2',
      R2_ACCOUNT_ID: 'acct_123',
      R2_ACCESS_KEY_ID: 'key_123',
      R2_SECRET_ACCESS_KEY: 'secret_123',
      R2_BUCKET_NAME: 'mr-outreach-assets',
    });
    expect(error?.message).toMatch(/R2_PUBLIC_BASE_URL/);
  });

  it('Fase Firma — rejects an unknown SIGNATURE_ASSET_STORAGE_MODE value', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, SIGNATURE_ASSET_STORAGE_MODE: 'gcs' });
    expect(error?.message).toMatch(/SIGNATURE_ASSET_STORAGE_MODE/);
  });

  const R2_MODE_ENV = {
    ...BASE_MEMORY_ENV,
    SIGNATURE_ASSET_STORAGE_MODE: 'r2',
    R2_ACCOUNT_ID: 'acct_123',
    R2_ACCESS_KEY_ID: 'key_123',
    R2_SECRET_ACCESS_KEY: 'secret_123',
    R2_BUCKET_NAME: 'mr-outreach-assets',
  };

  it('Fase Firma — accepts SIGNATURE_ASSET_STORAGE_MODE=r2 with a valid custom HTTPS domain', () => {
    const { error } = envValidationSchema.validate({ ...R2_MODE_ENV, R2_PUBLIC_BASE_URL: 'https://assets.mejoreferido.com' });
    expect(error).toBeUndefined();
  });

  it('Fase Firma — rejects R2_PUBLIC_BASE_URL over plain HTTP in r2 mode', () => {
    const { error } = envValidationSchema.validate({ ...R2_MODE_ENV, R2_PUBLIC_BASE_URL: 'http://assets.mejoreferido.com' });
    expect(error?.message).toMatch(/R2_PUBLIC_BASE_URL/);
  });

  it('Fase Firma — rejects the Cloudflare-issued r2.dev fallback domain in r2 mode', () => {
    const { error } = envValidationSchema.validate({ ...R2_MODE_ENV, R2_PUBLIC_BASE_URL: 'https://pub-abc123.r2.dev' });
    expect(error?.message).toMatch(/R2_PUBLIC_BASE_URL/);
  });

  it('Fase Firma — rejects an unsafe R2_SIGNATURE_PREFIX (path traversal / leading slash)', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, R2_SIGNATURE_PREFIX: '../etc' });
    expect(error?.message).toMatch(/R2_SIGNATURE_PREFIX/);
  });

  it('Fase 2 (R2) — accepts the default R2_SIGNATURE_PREFIX and R2_EMAIL_BODY_PREFIX', () => {
    const { error, value } = envValidationSchema.validate(BASE_MEMORY_ENV);
    expect(error).toBeUndefined();
    expect(value.R2_SIGNATURE_PREFIX).toBe('firmas');
    expect(value.R2_EMAIL_BODY_PREFIX).toBe('email-body');
  });

  it('Fase 2 (R2) — rejects an unsafe R2_EMAIL_BODY_PREFIX (path traversal / leading slash)', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, R2_EMAIL_BODY_PREFIX: '../etc' });
    expect(error?.message).toMatch(/R2_EMAIL_BODY_PREFIX/);
  });

  it('rejects a CREDENTIALS_ENCRYPTION_KEY that does not decode to exactly 32 bytes', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(16, 9).toString('base64'), // AES-128 length, not AES-256
    });
    expect(error?.message).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('rejects a CREDENTIALS_ENCRYPTION_KEY that is not valid base64', () => {
    const { error } = envValidationSchema.validate({
      ...BASE_MEMORY_ENV,
      CREDENTIALS_ENCRYPTION_KEY: 'not-valid-base64!!!',
    });
    expect(error?.message).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('rejects an unknown NODE_ENV value', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, NODE_ENV: 'qa' });
    expect(error?.message).toMatch(/NODE_ENV/);
  });

  it('rejects an unknown PERSISTENCE_DRIVER value', () => {
    const { error } = envValidationSchema.validate({ ...BASE_MEMORY_ENV, PERSISTENCE_DRIVER: 'mysql' });
    expect(error?.message).toMatch(/PERSISTENCE_DRIVER/);
  });
});
