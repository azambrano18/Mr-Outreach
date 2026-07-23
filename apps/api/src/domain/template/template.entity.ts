export type TemplateStatus = 'ACTIVE' | 'ARCHIVED';

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  body: string;
  status: TemplateStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateTemplateInput {
  organizationId: string;
  name: string;
  subject: string;
  body: string;
}

export interface UpdateTemplateInput {
  name?: string;
  subject?: string;
  body?: string;
  status?: TemplateStatus;
}
