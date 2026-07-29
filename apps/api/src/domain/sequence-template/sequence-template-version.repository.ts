import {
  CreateSequenceTemplateVersionInput,
  SequenceTemplateVersion,
  UpdateSequenceTemplateVersionInput,
} from './sequence-template-version.entity';

export interface SequenceTemplateVersionRepository {
  findById(id: string): Promise<SequenceTemplateVersion | null>;
  findByTemplate(templateId: string): Promise<SequenceTemplateVersion[]>;
  /** The most recent version regardless of status — used to compute the next versionNumber. */
  findLatestByTemplate(templateId: string): Promise<SequenceTemplateVersion | null>;
  findByServerTemplateId(serverTemplateId: string): Promise<SequenceTemplateVersion | null>;
  create(input: CreateSequenceTemplateVersionInput): Promise<SequenceTemplateVersion>;
  update(id: string, input: UpdateSequenceTemplateVersionInput): Promise<SequenceTemplateVersion>;
}
