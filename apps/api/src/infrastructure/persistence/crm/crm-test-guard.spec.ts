import { assertCrmDriverAllowedInTests } from './crm-test-guard';

describe('assertCrmDriverAllowedInTests', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is a no-op outside NODE_ENV=test, even with CRM_DRIVER=postgres', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_REAL_CRM_IN_TESTS;

    expect(() => assertCrmDriverAllowedInTests('postgres')).not.toThrow();
  });

  it('is a no-op when the driver is mock, regardless of NODE_ENV', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_REAL_CRM_IN_TESTS;

    expect(() => assertCrmDriverAllowedInTests('mock')).not.toThrow();
  });

  it('throws in NODE_ENV=test with CRM_DRIVER=postgres and no explicit authorization', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_REAL_CRM_IN_TESTS;

    expect(() => assertCrmDriverAllowedInTests('postgres')).toThrow(
      'Las pruebas ordinarias no pueden utilizar el CRM real. Usa CRM_DRIVER=mock o habilita explícitamente una prueba de integración CRM autorizada.',
    );
  });

  it('never mentions a connection string, host, user or password in its message', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_REAL_CRM_IN_TESTS;

    try {
      assertCrmDriverAllowedInTests('postgres');
      throw new Error('expected assertCrmDriverAllowedInTests to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/postgres:\/\//i);
      expect(message).not.toMatch(/neon\.tech/i);
      expect(message).not.toMatch(/password/i);
    }
  });

  it('allows CRM_DRIVER=postgres in tests when ALLOW_REAL_CRM_IN_TESTS=true', () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_REAL_CRM_IN_TESTS = 'true';

    expect(() => assertCrmDriverAllowedInTests('postgres')).not.toThrow();
  });

  it('does not treat any other value as authorization (e.g. "1", "yes")', () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_REAL_CRM_IN_TESTS = '1';

    expect(() => assertCrmDriverAllowedInTests('postgres')).toThrow();
  });
});
