export interface Role {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoleInput {
  organizationId: string;
  name: string;
  permissionKeys: string[];
}
