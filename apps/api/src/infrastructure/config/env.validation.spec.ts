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
