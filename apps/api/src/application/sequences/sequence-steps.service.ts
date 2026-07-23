import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { extractTemplateVariables } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { EngineClient } from '../../domain/engine/engine-client';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { OrganizationRepository } from '../../domain/organization/organization.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SignatureVersion } from '../../domain/signature/signature-version.entity';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { ENGINE_CLIENT } from '../../infrastructure/engine/tokens';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_REPOSITORY,
  ORGANIZATION_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SEQUENCE_STEP_VERSION_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { htmlToPlainText } from '../../infrastructure/security/html-to-plain-text';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { SequenceRenderContext, renderSequenceText } from './sequence-variable-resolver';
import {
  CreateSequenceStepPayload,
  SendTestStepResult,
  SequenceStepPreview,
  SequenceStepSummary,
  SequenceStepVersionSummary,
  UpdateSequenceStepPayload,
} from './sequence-steps.types';

const SIGNATURE_HTML_SEPARATOR = '<div style="margin-top:24px;"></div>';
const SIGNATURE_PLAIN_TEXT_SEPARATOR = '\n\n';

const CONTENT_FIELDS = [
  'subject',
  'preheader',
  'htmlHeader',
  'htmlBody',
  'plainTextBody',
  'delayValue',
  'delayUnit',
  'sendMode',
] as const;

const HEADER_BODY_SEPARATOR = '<div style="margin-top:16px;"></div>';

@Injectable()
export class SequenceStepsService {
  constructor(
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(SEQUENCE_STEP_VERSION_REPOSITORY)
    private readonly stepVersions: SequenceStepVersionRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY)
    private readonly signatureVersions: SignatureVersionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(ENGINE_CLIENT) private readonly engineClient: EngineClient,
    private readonly sanitizer: HtmlSanitizerService,
    private readonly secrets: SecretEncryptionService,
  ) {}

  async listBySequence(organizationId: string, sequenceId: string): Promise<SequenceStepSummary[]> {
    await this.getOwnedSequence(organizationId, sequenceId);
    const rows = await this.steps.findBySequence(sequenceId);
    return rows.map((row) => this.toSummary(row));
  }

  async getById(organizationId: string, stepId: string): Promise<SequenceStepSummary> {
    const step = await this.getOwnedStep(organizationId, stepId);
    return this.toSummary(step);
  }

  async create(
    organizationId: string,
    sequenceId: string,
    input: CreateSequenceStepPayload,
    actorId: string,
  ): Promise<SequenceStepSummary> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    const siblings = await this.steps.findBySequence(sequenceId);
    // §10 — a FIXED_3 sequence gets its 3 steps exactly once, via SequencesService.createFromWizard
    // (which calls this 3 times in a row for the same brand-new sequence — siblings.length 0/1/2 —
    // to bootstrap Enviados_1/2/3); nothing may add a 4th afterwards.
    if (sequence.stepPolicy === 'FIXED_3' && siblings.length >= 3) {
      throw new BadRequestException('Esta secuencia usa steps fijos (Enviados_1/2/3); no se puede agregar otro.');
    }
    const position = siblings.length + 1;

    const htmlBody = this.sanitizer.sanitize(input.htmlBody);
    const plainTextBody = input.plainTextBody?.trim() || htmlToPlainText(htmlBody);
    const htmlHeader = input.htmlHeader ? this.sanitizer.sanitize(input.htmlHeader) : null;

    const step = await this.steps.create({
      organizationId,
      sequenceId,
      position,
      name: input.name,
      subject: input.subject,
      preheader: input.preheader ?? null,
      htmlHeader,
      htmlBody,
      plainTextBody,
      delayValue: input.delayValue,
      delayUnit: input.delayUnit,
      sendMode: input.sendMode,
      createdBy: actorId,
    });

    await this.stepVersions.create({
      sequenceStepId: step.id,
      subject: step.subject,
      preheader: step.preheader,
      htmlHeader: step.htmlHeader,
      htmlBody: step.htmlBody,
      plainTextBody: step.plainTextBody,
      delayValue: step.delayValue,
      delayUnit: step.delayUnit,
      sendMode: step.sendMode,
      createdBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_step.create',
      entityType: 'SequenceStep',
      entityId: step.id,
      metadata: { sequenceId, position },
    });

    return this.toSummary(step);
  }

  async update(
    organizationId: string,
    stepId: string,
    input: UpdateSequenceStepPayload,
    actorId: string,
  ): Promise<SequenceStepSummary> {
    const existing = await this.getOwnedStep(organizationId, stepId);
    const sequence = await this.getOwnedSequence(organizationId, existing.sequenceId);

    if (sequence.stepPolicy === 'FIXED_3') {
      // §10 — Enviados_1/2/3's names/order are permanent.
      if (input.name !== undefined && input.name !== existing.name) {
        throw new BadRequestException('El nombre de este step es fijo y no puede cambiarse.');
      }
      // §15 — the subject is only editable on Enviados_1; steps 2/3 always mirror it (see the cascade below).
      if (input.subject !== undefined && existing.position !== 1) {
        throw new BadRequestException('El asunto se hereda de Enviados_1 y no puede editarse en este step.');
      }
    }

    const patch: Record<string, unknown> = { updatedBy: actorId };
    if (input.name !== undefined) patch.name = input.name;
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.preheader !== undefined) patch.preheader = input.preheader;
    if (input.htmlHeader !== undefined) {
      patch.htmlHeader = input.htmlHeader ? this.sanitizer.sanitize(input.htmlHeader) : null;
    }
    if (input.htmlBody !== undefined) patch.htmlBody = this.sanitizer.sanitize(input.htmlBody);
    if (input.delayValue !== undefined) patch.delayValue = input.delayValue;
    if (input.delayUnit !== undefined) patch.delayUnit = input.delayUnit;
    if (input.sendMode !== undefined) patch.sendMode = input.sendMode;
    if (input.status !== undefined) patch.status = input.status;
    // plainTextBody: explicit value wins; otherwise, if htmlBody changed
    // and no plain text was supplied, regenerate it from the new HTML —
    // matches "restaurar la generación automática" (section 8).
    if (input.plainTextBody !== undefined) {
      patch.plainTextBody = input.plainTextBody;
    } else if (patch.htmlBody !== undefined) {
      patch.plainTextBody = htmlToPlainText(patch.htmlBody as string);
    }

    const updated = await this.steps.update(existing.id, patch);

    // §15 — Enviados_2/3's subject is not just locked, it physically mirrors Enviados_1's
    // whenever Enviados_1's own subject changes, so previews/publish/summaries never need to
    // special-case "look up step 1 instead" — the field itself always holds the right value.
    if (sequence.stepPolicy === 'FIXED_3' && existing.position === 1 && input.subject !== undefined) {
      const siblings = await this.steps.findBySequence(existing.sequenceId);
      for (const sibling of siblings) {
        if (sibling.id !== updated.id) {
          await this.steps.update(sibling.id, { subject: updated.subject, updatedBy: actorId });
        }
      }
    }

    // Deliberately `!== undefined`, not `field in input`: with this
    // project's `target: ES2022` tsconfig, `useDefineForClassFields`
    // makes every declared DTO class field an own property (value
    // `undefined`) even when the caller never sent it, so `in` would
    // always be true and version a bare status change too.
    const contentChanged = CONTENT_FIELDS.some(
      (field) => input[field as keyof UpdateSequenceStepPayload] !== undefined,
    );
    if (contentChanged) {
      await this.stepVersions.create({
        sequenceStepId: updated.id,
        subject: updated.subject,
        preheader: updated.preheader,
        htmlHeader: updated.htmlHeader,
        htmlBody: updated.htmlBody,
        plainTextBody: updated.plainTextBody,
        delayValue: updated.delayValue,
        delayUnit: updated.delayUnit,
        sendMode: updated.sendMode,
        createdBy: actorId,
      });
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_step.update',
      entityType: 'SequenceStep',
      entityId: stepId,
      metadata: { fieldsChanged: Object.keys(input) },
    });

    return this.toSummary(updated);
  }

  async remove(organizationId: string, stepId: string, actorId: string): Promise<void> {
    const existing = await this.getOwnedStep(organizationId, stepId);
    const sequence = await this.getOwnedSequence(organizationId, existing.sequenceId);
    if (sequence.stepPolicy === 'FIXED_3') {
      throw new BadRequestException('Esta secuencia usa steps fijos (Enviados_1/2/3); no se puede eliminar uno.');
    }
    await this.steps.remove(existing.id);
    await this.renormalizePositions(existing.sequenceId, actorId);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_step.delete',
      entityType: 'SequenceStep',
      entityId: stepId,
    });
  }

  async duplicate(
    organizationId: string,
    stepId: string,
    actorId: string,
  ): Promise<SequenceStepSummary> {
    const original = await this.getOwnedStep(organizationId, stepId);
    const sequence = await this.getOwnedSequence(organizationId, original.sequenceId);
    if (sequence.stepPolicy === 'FIXED_3') {
      throw new BadRequestException('Esta secuencia usa steps fijos (Enviados_1/2/3); no se puede duplicar uno.');
    }
    const siblings = await this.steps.findBySequence(original.sequenceId);

    // Shift everyone after the original down by one to make room right
    // after it, then insert the copy at that position.
    const toShift = siblings.filter((s) => s.position > original.position);
    for (const sibling of toShift) {
      await this.steps.update(sibling.id, { position: sibling.position + 1, updatedBy: actorId });
    }

    const copy = await this.steps.create({
      organizationId,
      sequenceId: original.sequenceId,
      position: original.position + 1,
      name: `${original.name} (copia)`,
      subject: original.subject,
      preheader: original.preheader,
      htmlHeader: original.htmlHeader,
      htmlBody: original.htmlBody,
      plainTextBody: original.plainTextBody,
      delayValue: original.delayValue,
      delayUnit: original.delayUnit,
      sendMode: original.sendMode,
      createdBy: actorId,
    });

    await this.stepVersions.create({
      sequenceStepId: copy.id,
      subject: copy.subject,
      preheader: copy.preheader,
      htmlHeader: copy.htmlHeader,
      htmlBody: copy.htmlBody,
      plainTextBody: copy.plainTextBody,
      delayValue: copy.delayValue,
      delayUnit: copy.delayUnit,
      sendMode: copy.sendMode,
      createdBy: actorId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_step.duplicate',
      entityType: 'SequenceStep',
      entityId: copy.id,
      metadata: { sourceStepId: stepId },
    });

    return this.toSummary(copy);
  }

  /** Transactional in spirit: validates the full desired order before writing anything. */
  async reorder(
    organizationId: string,
    sequenceId: string,
    stepIds: string[],
    actorId: string,
  ): Promise<SequenceStepSummary[]> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    if (sequence.stepPolicy === 'FIXED_3') {
      throw new BadRequestException('Esta secuencia usa steps fijos (Enviados_1/2/3); su orden no puede cambiarse.');
    }
    const current = await this.steps.findBySequence(sequenceId);

    const currentIds = new Set(current.map((s) => s.id));
    const desiredIds = new Set(stepIds);
    if (currentIds.size !== desiredIds.size || current.some((step) => !desiredIds.has(step.id))) {
      throw new BadRequestException(
        'The reorder list must contain exactly the sequence’s current steps.',
      );
    }

    for (let index = 0; index < stepIds.length; index += 1) {
      await this.steps.update(stepIds[index], { position: index + 1, updatedBy: actorId });
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_step.reorder',
      entityType: 'Sequence',
      entityId: sequenceId,
      metadata: { order: stepIds },
    });

    const reordered = await this.steps.findBySequence(sequenceId);
    return reordered.map((row) => this.toSummary(row));
  }

  async getVersions(organizationId: string, stepId: string): Promise<SequenceStepVersionSummary[]> {
    const step = await this.getOwnedStep(organizationId, stepId);
    const versions = await this.stepVersions.findByStep(step.id);
    return versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      subject: version.subject,
      preheader: version.preheader,
      htmlHeader: version.htmlHeader,
      htmlBody: version.htmlBody,
      plainTextBody: version.plainTextBody,
      delayValue: version.delayValue,
      delayUnit: version.delayUnit,
      sendMode: version.sendMode,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
    }));
  }

  async preview(organizationId: string, stepId: string): Promise<SequenceStepPreview> {
    const step = await this.getOwnedStep(organizationId, stepId);
    const sequence = await this.getOwnedSequence(organizationId, step.sequenceId);
    const mailbox = await this.requireSenderMailbox(organizationId, sequence);
    const ctx = await this.buildRenderContext(organizationId, sequence, mailbox);

    const signatureVersion = await this.getActiveSignatureVersion(mailbox.id);
    const composedHtml = this.composeHtml(step.htmlBody, signatureVersion);
    const composedText = this.composeText(step.plainTextBody, signatureVersion);

    const subjectVariables = extractTemplateVariables(step.subject);
    const preheaderVariables = step.preheader ? extractTemplateVariables(step.preheader) : [];
    const headerVariables = step.htmlHeader ? extractTemplateVariables(step.htmlHeader) : [];
    const bodyVariables = extractTemplateVariables(composedHtml);
    const allVariables = [
      ...new Set([...subjectVariables, ...preheaderVariables, ...headerVariables, ...bodyVariables]),
    ];

    const subjectResult = renderSequenceText(step.subject, subjectVariables, ctx);
    const preheaderResult = step.preheader
      ? renderSequenceText(step.preheader, preheaderVariables, ctx)
      : null;
    const headerResult = step.htmlHeader
      ? renderSequenceText(step.htmlHeader, headerVariables, ctx)
      : null;
    const bodyResult = renderSequenceText(composedHtml, bodyVariables, ctx);
    const textResult = renderSequenceText(
      composedText,
      extractTemplateVariables(composedText),
      ctx,
    );

    return {
      subject: step.subject,
      renderedSubject: subjectResult.rendered,
      preheader: step.preheader,
      renderedPreheader: preheaderResult?.rendered ?? null,
      htmlHeader: step.htmlHeader,
      renderedHeader: headerResult?.rendered ?? null,
      renderedHtml: bodyResult.rendered,
      renderedPlainText: textResult.rendered,
      variables: allVariables,
      usesRealSenderData:
        subjectResult.usesRealSenderData ||
        (headerResult?.usesRealSenderData ?? false) ||
        bodyResult.usesRealSenderData ||
        textResult.usesRealSenderData,
      signatureApplied: !!signatureVersion,
      senderMailboxEmail: mailbox.email,
    };
  }

  async sendTest(
    organizationId: string,
    stepId: string,
    to: string,
    actorId: string,
  ): Promise<SendTestStepResult> {
    const step = await this.getOwnedStep(organizationId, stepId);
    const sequence = await this.getOwnedSequence(organizationId, step.sequenceId);
    const mailbox = await this.requireSenderMailbox(organizationId, sequence);
    const ctx = await this.buildRenderContext(organizationId, sequence, mailbox);

    const signatureVersion = await this.getActiveSignatureVersion(mailbox.id);
    const composedHtml = this.composeHtml(step.htmlBody, signatureVersion, step.htmlHeader);
    const composedText = this.composeText(step.plainTextBody, signatureVersion);

    const subject = renderSequenceText(
      step.subject,
      extractTemplateVariables(step.subject),
      ctx,
    ).rendered;
    const html = renderSequenceText(
      composedHtml,
      extractTemplateVariables(composedHtml),
      ctx,
    ).rendered;
    const text = renderSequenceText(
      composedText,
      extractTemplateVariables(composedText),
      ctx,
    ).rendered;

    const result = await this.engineClient.sendMail({
      mailboxEmail: mailbox.email,
      smtp: {
        host: mailbox.smtp.host,
        port: mailbox.smtp.port,
        encryption: mailbox.smtp.encryption,
        username: mailbox.smtp.username,
        password: this.secrets.decrypt(mailbox.smtp.secretCiphertext),
        verifyCertificate: mailbox.smtp.verifyCertificate,
      },
      fromName: mailbox.fromName,
      to,
      subject,
      html,
      text,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence_step.test_send',
      entityType: 'SequenceStep',
      entityId: step.id,
      metadata: { accepted: result.accepted, errorCode: result.errorCode ?? null },
    });

    return {
      accepted: result.accepted,
      message: result.accepted
        ? 'Correo de prueba aceptado por el servidor SMTP.'
        : `El servidor SMTP no aceptó el mensaje (${result.errorCode ?? 'error desconocido'}).`,
    };
  }

  /**
   * Self-service ownership check for the /me/sequence-steps routes — 404s
   * (never 403) unless the step's parent sequence belongs to this
   * executive, so an executive can never learn whether a colleague's step
   * id exists.
   */
  async requireOwnedByExecutive(
    organizationId: string,
    stepId: string,
    executiveId: string,
  ): Promise<SequenceStepSummary> {
    const step = await this.getOwnedStep(organizationId, stepId);
    const sequence = await this.getOwnedSequence(organizationId, step.sequenceId);
    if (sequence.executiveId !== executiveId) {
      throw new NotFoundException('Sequence step not found.');
    }
    return this.toSummary(step);
  }

  private composeHtml(
    stepHtml: string,
    signatureVersion: SignatureVersion | null,
    htmlHeader?: string | null,
  ): string {
    const withHeader = htmlHeader ? `${htmlHeader}${HEADER_BODY_SEPARATOR}${stepHtml}` : stepHtml;
    if (!signatureVersion) return withHeader;
    return `${withHeader}${SIGNATURE_HTML_SEPARATOR}${signatureVersion.htmlContent}`;
  }

  private composeText(stepText: string, signatureVersion: SignatureVersion | null): string {
    if (!signatureVersion) return stepText;
    return `${stepText}${SIGNATURE_PLAIN_TEXT_SEPARATOR}${signatureVersion.plainTextContent}`;
  }

  private async getActiveSignatureVersion(mailboxId: string): Promise<SignatureVersion | null> {
    const signature = await this.signatures.findByMailbox(mailboxId);
    if (!signature || signature.status !== 'ACTIVE' || !signature.activeVersionId) {
      return null;
    }
    return this.signatureVersions.findById(signature.activeVersionId);
  }

  private async requireSenderMailbox(organizationId: string, sequence: Sequence): Promise<Mailbox> {
    if (!sequence.mailboxId) {
      throw new BadRequestException('This sequence has no sender account configured yet.');
    }
    const mailbox = await this.mailboxes.findById(sequence.mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Sender mailbox not found.');
    }
    return mailbox;
  }

  private async buildRenderContext(
    organizationId: string,
    sequence: Sequence,
    mailbox: Mailbox,
  ): Promise<SequenceRenderContext> {
    const organization = await this.organizations.findById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }
    const sender: User | null = await this.users.findById(sequence.executiveId);
    return { mailbox, organization, sender };
  }

  private async renormalizePositions(sequenceId: string, actorId: string): Promise<void> {
    const remaining = await this.steps.findBySequence(sequenceId);
    for (let index = 0; index < remaining.length; index += 1) {
      if (remaining[index].position !== index + 1) {
        await this.steps.update(remaining[index].id, { position: index + 1, updatedBy: actorId });
      }
    }
  }

  private async getOwnedSequence(organizationId: string, sequenceId: string): Promise<Sequence> {
    const sequence = await this.sequences.findById(sequenceId);
    if (!sequence || sequence.organizationId !== organizationId) {
      throw new NotFoundException('Sequence not found.');
    }
    return sequence;
  }

  private async getOwnedStep(organizationId: string, stepId: string): Promise<SequenceStep> {
    const step = await this.steps.findById(stepId);
    if (!step || step.organizationId !== organizationId) {
      throw new NotFoundException('Sequence step not found.');
    }
    return step;
  }

  private toSummary(step: SequenceStep): SequenceStepSummary {
    return {
      id: step.id,
      sequenceId: step.sequenceId,
      position: step.position,
      name: step.name,
      subject: step.subject,
      preheader: step.preheader,
      htmlHeader: step.htmlHeader,
      htmlBody: step.htmlBody,
      plainTextBody: step.plainTextBody,
      variables: [
        ...new Set([
          ...extractTemplateVariables(step.subject),
          ...(step.htmlHeader ? extractTemplateVariables(step.htmlHeader) : []),
          ...extractTemplateVariables(step.htmlBody),
        ]),
      ],
      delayValue: step.delayValue,
      delayUnit: step.delayUnit,
      sendMode: step.sendMode,
      status: step.status,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    };
  }
}
