import { TemplateStatus } from '../../domain/template/template.entity';

export interface TemplateSummary {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  body: string;
  status: TemplateStatus;
  /** Unique {variable} names found across subject + body, in first-seen order. */
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplatePayload {
  name: string;
  subject: string;
  body: string;
}

export interface UpdateTemplatePayload {
  name?: string;
  subject?: string;
  body?: string;
}
