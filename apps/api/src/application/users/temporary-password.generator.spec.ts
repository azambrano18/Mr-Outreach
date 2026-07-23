import { generateTemporaryPassword } from './temporary-password.generator';

describe('generateTemporaryPassword', () => {
  it('generates a password of at least 16 characters', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(16);
  });

  it('always includes at least one lowercase, uppercase, digit and symbol', () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*\-_=+]/);
    }
  });

  it('never repeats the exact same password across many calls', () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(100);
  });
});
