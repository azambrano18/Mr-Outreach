export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface LoginResult {
  accessToken: string;
  user: AuthenticatedUser;
}
