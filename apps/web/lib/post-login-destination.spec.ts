import { getPostLoginDestination } from './post-login-destination';

describe('getPostLoginDestination', () => {
  it('sends a user with a pending forced password change to /dashboard/change-password', () => {
    expect(getPostLoginDestination({ mustChangePassword: true })).toBe('/dashboard/change-password');
  });

  it('sends a user without a pending forced password change to /dashboard', () => {
    expect(getPostLoginDestination({ mustChangePassword: false })).toBe('/dashboard');
  });
});
