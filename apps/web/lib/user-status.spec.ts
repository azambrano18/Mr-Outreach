import { parseUserStatus } from './user-status';

describe('parseUserStatus', () => {
  it('accepts exactly "ACTIVE"', () => {
    expect(parseUserStatus('ACTIVE')).toBe('ACTIVE');
  });

  it('accepts exactly "INACTIVE"', () => {
    expect(parseUserStatus('INACTIVE')).toBe('INACTIVE');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['lowercase active', 'active'],
    ['lowercase inactive', 'inactive'],
    ['an unrelated string', 'SUSPENDED'],
    ['an empty string', ''],
    ['a number', 0],
    ['a boolean', false],
    ['an object', { status: 'ACTIVE' }],
  ])('returns null for %s — never guesses', (_label, value) => {
    expect(parseUserStatus(value)).toBeNull();
  });
});
