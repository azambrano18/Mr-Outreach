import { CreateTemplateInput, Template, UpdateTemplateInput } from './template.entity';

export interface TemplateRepository {
  findById(id: string): Promise<Template | null>;
  findAll(organizationId: string): Promise<Template[]>;
  create(input: CreateTemplateInput): Promise<Template>;
  update(id: string, input: UpdateTemplateInput): Promise<Template>;
  /** Sets deletedAt — findById/findAll exclude the row afterwards, same as Mailbox. */
  softDelete(id: string): Promise<void>;
}
