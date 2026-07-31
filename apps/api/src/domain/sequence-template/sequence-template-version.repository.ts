import { TransactionContext } from '../persistence/transaction';
import {
  CreateSequenceTemplateVersionInput,
  SequenceTemplateVersion,
  UpdateSequenceTemplateVersionInput,
} from './sequence-template-version.entity';

export interface SequenceTemplateVersionRepository {
  findById(id: string): Promise<SequenceTemplateVersion | null>;
  findByTemplate(templateId: string): Promise<SequenceTemplateVersion[]>;
  /** The most recent version regardless of status — used ONLY to compute the next versionNumber and to show full history; never to resolve "the active version" (see findLatestAcceptedByTemplate). */
  findLatestByTemplate(templateId: string): Promise<SequenceTemplateVersion | null>;
  /**
   * The most recent ACCEPTED version — the one Gestiones/selectors/"published
   * version" displays must use. Skips over any later FAILED attempt: if v1 is
   * ACCEPTED and v2 is FAILED, this returns v1, so a failed publish attempt
   * never blocks creating new Gestiones or starting another corrected version.
   */
  findLatestAcceptedByTemplate(templateId: string): Promise<SequenceTemplateVersion | null>;
  findByServerTemplateId(serverTemplateId: string): Promise<SequenceTemplateVersion | null>;
  create(input: CreateSequenceTemplateVersionInput, ctx?: TransactionContext): Promise<SequenceTemplateVersion>;
  update(id: string, input: UpdateSequenceTemplateVersionInput, ctx?: TransactionContext): Promise<SequenceTemplateVersion>;
}
