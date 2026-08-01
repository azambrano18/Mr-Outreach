export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface User {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  /** True right after an admin creates the account or resets its password — cleared by AuthService.changePassword. */
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateUserInput {
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  status?: UserStatus;
  mustChangePassword?: boolean;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  passwordHash?: string;
  status?: UserStatus;
  mustChangePassword?: boolean;
  lastLoginAt?: Date;
  passwordChangedAt?: Date | null;
  /** Set once, on deletion — see UsersService.remove. Every read path already filters `deletedAt: null`. */
  deletedAt?: Date;
}

/** Display-only, derived — never persisted as its own column. */
export function fullName(user: Pick<User, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
