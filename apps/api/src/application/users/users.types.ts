export interface UserSummary {
  id: string;
  organizationId: string;
  /** Derived (`${firstName} ${lastName}`) — never persisted as its own column. */
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  roleId: string;
  roleName: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** Returned once, only from the endpoint call that generated the password. */
export interface CreateUserResult extends UserSummary {
  temporaryPassword: string;
}

export interface ResetPasswordResult {
  email: string;
  temporaryPassword: string;
}

export interface CreateExecutiveInput {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
}

export interface UpdateExecutiveInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  roleId?: string;
}
