import {
  CreateSequenceTemplateStepInput,
  SequenceTemplateStep,
  UpdateSequenceTemplateStepInput,
} from './sequence-template-step.entity';

export interface SequenceTemplateStepRepository {
  findByTemplate(templateId: string): Promise<SequenceTemplateStep[]>;
  findById(id: string): Promise<SequenceTemplateStep | null>;
  create(input: CreateSequenceTemplateStepInput): Promise<SequenceTemplateStep>;
  update(id: string, input: UpdateSequenceTemplateStepInput): Promise<SequenceTemplateStep>;
  /** §8 — removes every envío row for a template being hard-deleted (never-published DRAFT). */
  deleteByTemplate(templateId: string): Promise<void>;
}
